/**
 * Kesetaraan fungsi SQL usage_hours_by_week / latest_audit_activity (migrasi 0099)
 * dengan aggregateUsageByWeek (src/lib/m3/usage.ts).
 *
 * Butuh Postgres sungguhan (repo ini tidak punya dependency pg): jalankan dengan
 *   MCN_TEST_PG_URL=postgres://user@host:port/db_kosong npx vitest run usage-sql
 * Semua dijalankan di dalam satu transaksi yang di-ROLLBACK — database tidak berubah.
 * Tanpa env var / psql, suite ini di-skip (CI tidak punya Postgres).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateUsageByWeek, finalizeWeeklyUsage, type UsageLog } from "../usage";

const PG_URL = process.env.MCN_TEST_PG_URL;
const MIGRATION = join(__dirname, "../../../../supabase/migrations/0099_usage_adoption_rpc.sql");

const LEAD = "00000000-0000-0000-0000-00000000000a";
const STAFF = "00000000-0000-0000-0000-00000000000b";
const MEMBERS = [1, 2, 3, 4].map((i) => `00000000-0000-0000-0000-00000000010${i}`);
const SINCE = "2026-07-27T00:00:00.000Z";

/** PRNG deterministik (mulberry32) supaya fixture stabil. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fixture(): UsageLog[] {
  const r = rng(42);
  const logs: UsageLog[] = [];
  // 10 minggu acak: Senin 2026-08-17 .. 2026-10-25, gap acak 0–70 menit.
  for (const m of MEMBERS) {
    let t = Date.UTC(2026, 7, 17, 1, 0, 0);
    const end = Date.UTC(2026, 9, 26);
    while (t < end) {
      logs.push({ member_id: m, occurred_at: new Date(t).toISOString() });
      const x = r();
      t += x < 0.85 ? Math.floor(r() * 70) * 60_000 + Math.floor(r() * 60) * 1000 : Math.floor(r() * 3 * 86_400_000);
    }
  }
  const m = MEMBERS[0];
  // Tepi: gap tepat 30 menit (sesi sama), 30m+1ms (sesi baru), timestamp duplikat,
  // sesi Minggu→Senin (masuk minggu mulai), baris sebelum jendela (diabaikan).
  logs.push(
    { member_id: m, occurred_at: "2026-08-09T23:50:00.000Z" },
    { member_id: m, occurred_at: "2026-08-10T00:20:00.000Z" },
    { member_id: m, occurred_at: "2026-08-10T00:50:00.001Z" },
    { member_id: m, occurred_at: "2026-08-10T00:50:00.001Z" },
    { member_id: m, occurred_at: "2026-07-26T10:00:00.000Z" },
    { member_id: m, occurred_at: "2026-07-27T00:10:00.000Z" }
  );
  return logs;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function runSql(logs: UsageLog[], audit: { actor_id: string; action: string; created_at: string }[]): string[] {
  const values = (rows: string[]) => (rows.length ? rows.join(",\n") : null);
  const usageValues = values(logs.map((l) => `(${q(l.member_id)}::uuid, ${q(l.occurred_at)}::timestamptz)`));
  const auditValues = values(audit.map((a) => `(${q(a.actor_id)}::uuid, ${q(a.action)}, ${q(a.created_at)}::timestamptz)`));
  const script = `
\\set ON_ERROR_STOP 1
begin;
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create type role_t as enum ('director','head','spv','cm_lead','cpm','bizdev_lead','bizdev','creator_user');
create table team_members (id uuid primary key, role role_t not null, active boolean not null default true);
create table tool_usage_logs (id bigserial primary key, member_id uuid not null, path text not null default '/', occurred_at timestamptz default now());
create table audit_logs (id bigserial primary key, actor_id uuid, action text, created_at timestamptz default now());
-- salinan persis helper dari 0002_rls_rbac_policies.sql
create or replace function public.current_member_role() returns role_t
language sql stable security definer set search_path = public as $$
  select role from team_members where id = auth.uid() and active
$$;
insert into team_members values (${q(LEAD)}, 'bizdev_lead', true), (${q(STAFF)}, 'cpm', true);
${usageValues ? `insert into tool_usage_logs (member_id, occurred_at) values ${usageValues};` : ""}
${auditValues ? `insert into audit_logs (actor_id, action, created_at) values ${auditValues};` : ""}
\\i ${MIGRATION}
select set_config('test.uid', ${q(LEAD)}, true);
select usage_hours_by_week(${q(SINCE)}, 30, 5);
select latest_audit_activity(${q(SINCE)});
select set_config('test.uid', ${q(STAFF)}, true);
select usage_hours_by_week(${q(SINCE)}, 30, 5);
select latest_audit_activity(${q(SINCE)});
rollback;
`;
  const out = execFileSync("psql", [PG_URL!, "-X", "-q", "-A", "-t", "-f", "-"], {
    input: script,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\n").filter((l) => l.startsWith("[") || l.startsWith("{"));
}

describe.skipIf(!PG_URL)("SQL usage_hours_by_week ≡ aggregateUsageByWeek (migrasi 0099)", () => {
  it("hasil per member × minggu identik untuk fixture >1000 baris, 10 minggu", () => {
    const logs = fixture();
    expect(logs.length).toBeGreaterThan(1000);
    const audit = [
      { actor_id: MEMBERS[1], action: "creator.update", created_at: "2026-08-20T03:00:00.000Z" },
      { actor_id: MEMBERS[1], action: "deal.create", created_at: "2026-09-01T03:00:00.000Z" },
      { actor_id: MEMBERS[2], action: "old.action", created_at: "2026-07-01T03:00:00.000Z" },
      ...Array.from({ length: 1500 }, (_, i) => ({
        actor_id: MEMBERS[0],
        action: "ingest.row",
        created_at: new Date(Date.UTC(2026, 9, 20) + i * 60_000).toISOString(),
      })),
    ];
    const [usageJson, auditJson, staffUsage, staffAudit] = runSql(logs, audit);

    const sqlRows = JSON.parse(usageJson) as {
      member_id: string; week_start: string; seconds: number; sessions: number; page_views: number; last_access: string;
    }[];
    const fromSql = finalizeWeeklyUsage(
      sqlRows.map((r) => ({
        memberId: r.member_id,
        weekStart: r.week_start,
        month: r.week_start.slice(0, 7),
        hours: Number(r.seconds) / 3600,
        sessions: r.sessions,
        pageViews: r.page_views,
      }))
    );
    const expected = aggregateUsageByWeek(logs.filter((l) => l.occurred_at >= SINCE));
    expect(new Set(expected.filter((w) => w.weekStart >= "2026-08-17").map((w) => w.weekStart)).size).toBe(10);
    expect(fromSql).toEqual(expected);

    // Total jam: SQL vs JS (±1%).
    const total = (rows: { hours: number }[]) => rows.reduce((s, r) => s + r.hours, 0);
    expect(Math.abs(total(fromSql) - total(expected)) / total(expected)).toBeLessThan(0.01);

    // Last Access = view paling baru per member.
    for (const m of MEMBERS) {
      const latest = logs.filter((l) => l.member_id === m).map((l) => Date.parse(l.occurred_at)).sort((a, b) => b - a)[0];
      const got = sqlRows.find((r) => r.member_id === m)!.last_access;
      expect(Date.parse(got)).toBe(latest);
    }

    // Last Activity: aksi terbaru per actor di jendela, walau tertimbun 1500 aksi lain.
    const latestAudit = JSON.parse(auditJson) as { actor_id: string; action: string; created_at: string }[];
    expect(latestAudit).toHaveLength(2);
    const m1 = latestAudit.find((a) => a.actor_id === MEMBERS[1])!;
    expect(m1.action).toBe("deal.create");
    expect(Date.parse(m1.created_at)).toBe(Date.parse("2026-09-01T03:00:00.000Z"));

    // Gate: non-lead (cpm) tidak melihat apa pun.
    expect(JSON.parse(staffUsage)).toEqual([]);
    expect(JSON.parse(staffAudit)).toEqual([]);
  });
});

// Pastikan file migrasi ada & memuat fungsi yang dipanggil loader (selalu jalan, juga di CI).
describe("migrasi 0099", () => {
  it("mendefinisikan RPC yang dipakai loadUsageAdoption", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/function public\.usage_hours_by_week\(/);
    expect(sql).toMatch(/function public\.latest_audit_activity\(/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/security definer/);
  });
});

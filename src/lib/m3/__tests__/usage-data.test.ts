import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateUsageByWeek, type UsageLog } from "../usage";
import { loadUsageAdoption } from "../usage-data";

/**
 * Regresi feedback Tim OD 26 Okt 2026: tabel adopsi /okr hanya menampilkan
 * 2 minggu terakhir. PostgREST memotong tiap response di `max_rows` (default
 * Supabase 1000) — di luar kendali `.limit()` — jadi agregasi di JS atas baris
 * mentah kehilangan minggu lama begitu volume log > 1000.
 *
 * Fake client di bawah meniru batas itu: `.from()` mengembalikan maksimal
 * MAX_ROWS baris per request. RPC dijawab dari SELURUH fixture (seperti fungsi
 * SQL yang berjalan di database); kesetaraan fungsi SQL-nya sendiri dengan
 * aggregateUsageByWeek dijaga usage-sql.test.ts.
 */
const MAX_ROWS = 1000;
const SINCE = "2026-07-27T00:00:00Z";

type Row = Record<string, unknown>;

function fakeSupabase(tables: Record<string, Row[]>) {
  const calls: string[] = [];
  const from = (table: string) => {
    calls.push(`from:${table}`);
    let rows = [...(tables[table] ?? [])];
    let limit = Infinity;
    const q = {
      select: () => q,
      gte: (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]) >= v)), q),
      not: (col: string) => ((rows = rows.filter((r) => r[col] != null)), q),
      order: (col: string, opts?: { ascending?: boolean }) => {
        const dir = opts?.ascending === false ? -1 : 1;
        rows.sort((a, b) => dir * String(a[col]).localeCompare(String(b[col])));
        return q;
      },
      limit: (n: number) => ((limit = n), q),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows.slice(0, Math.min(limit, MAX_ROWS)), error: null }),
    };
    return q;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${fn}`);
    const since = String(args.p_from);
    if (fn === "usage_hours_by_week") {
      const logs = (tables.tool_usage_logs as unknown as UsageLog[]).filter((l) => l.occurred_at >= since);
      const last = new Map<string, string>();
      for (const l of logs) if (!last.has(l.member_id) || l.occurred_at > last.get(l.member_id)!) last.set(l.member_id, l.occurred_at);
      const data = aggregateUsageByWeek(logs, Number(args.p_gap_minutes), Number(args.p_min_session_minutes)).map((w) => ({
        member_id: w.memberId,
        week_start: w.weekStart,
        seconds: w.hours * 3600,
        sessions: w.sessions,
        page_views: w.pageViews,
        last_access: last.get(w.memberId),
      }));
      return { data, error: null };
    }
    if (fn === "latest_audit_activity") {
      const latest = new Map<string, Row>();
      for (const a of tables.audit_logs.filter((r) => r.actor_id != null && String(r.created_at) >= since)) {
        const cur = latest.get(String(a.actor_id));
        if (!cur || String(a.created_at) > String(cur.created_at)) latest.set(String(a.actor_id), a);
      }
      return { data: [...latest.values()], error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, calls };
}

const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

/** 10 minggu (Senin 2026-08-17 .. 2026-10-19), 2 member, >1000 baris total. */
function usageFixture(): UsageLog[] {
  const logs: UsageLog[] = [];
  const firstMonday = Date.UTC(2026, 7, 17);
  for (let w = 0; w < 10; w++) {
    for (let d = 0; d < 5; d++) {
      const dayStart = firstMonday + (w * 7 + d) * DAY + 2 * 3_600_000; // 09:00 WIB
      // u1: satu sesi 30 view tiap 2 menit (58 menit)
      for (let i = 0; i < 30; i++) logs.push({ member_id: "u1", occurred_at: iso(dayStart + i * 120_000) });
      // u2: 2 view berjarak 45 menit → 2 sesi minimal
      logs.push({ member_id: "u2", occurred_at: iso(dayStart) });
      logs.push({ member_id: "u2", occurred_at: iso(dayStart + 45 * 60_000) });
    }
  }
  return logs;
}

describe("loadUsageAdoption (batas max_rows PostgREST)", () => {
  it("fixture memang melampaui batas baris per request", () => {
    expect(usageFixture().length).toBe(1600);
    expect(usageFixture().length).toBeGreaterThan(MAX_ROWS);
  });

  it("menampilkan SEMUA 10 minggu walau sumber hanya mengembalikan 1000 baris per request", async () => {
    const logs = usageFixture();
    const { client } = fakeSupabase({ tool_usage_logs: logs as unknown as Row[], audit_logs: [] });
    const { weekly, lastAccessByMember } = await loadUsageAdoption(client, SINCE);

    const weeks = new Set(weekly.map((w) => w.weekStart));
    expect(weeks.size).toBe(10);
    expect([...weeks].sort()[0]).toBe("2026-08-17");

    // Angka per minggu sama dengan agregasi atas data lengkap.
    const expected = aggregateUsageByWeek(logs);
    expect(weekly).toEqual(expected);
    const u1w1 = weekly.find((w) => w.memberId === "u1" && w.weekStart === "2026-08-17")!;
    expect(u1w1).toMatchObject({ sessions: 5, pageViews: 150, hours: 4.8 });

    // Last Access tetap dari aktivitas paling baru.
    expect(lastAccessByMember.get("u1")).toBe(logs.filter((l) => l.member_id === "u1").at(-1)!.occurred_at);
  });

  it("Last Activity tidak hilang untuk member yang aksinya tertimbun >1000 aksi lebih baru", async () => {
    const audit: Row[] = [{ actor_id: "u_old", action: "creator.update", created_at: "2026-08-20T03:00:00.000Z" }];
    for (let i = 0; i < 1500; i++) {
      audit.push({ actor_id: "u_busy", action: "ingest.row", created_at: iso(Date.UTC(2026, 9, 20) + i * 60_000) });
    }
    const { client } = fakeSupabase({ tool_usage_logs: [], audit_logs: audit });
    const { lastActivityByMember } = await loadUsageAdoption(client, SINCE);
    expect(lastActivityByMember.get("u_old")).toEqual({ at: "2026-08-20T03:00:00.000Z", action: "creator.update" });
    expect(lastActivityByMember.get("u_busy")?.at).toBe(String(audit.at(-1)!.created_at));
  });
});

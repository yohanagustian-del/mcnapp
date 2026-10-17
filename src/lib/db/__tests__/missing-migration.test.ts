import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissingRelationError } from "../missing-migration";

describe("isMissingRelationError", () => {
  it("mengenali kode Postgres & PostgREST untuk tabel/kolom yang belum ada", () => {
    expect(isMissingRelationError({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingRelationError({ code: "PGRST205", message: "Could not find the table 'public.x' in the schema cache" })).toBe(true);
    expect(isMissingRelationError({ code: "42703", message: "column brand_reports.shop_key does not exist" })).toBe(true);
    expect(isMissingRelationError({ message: 'relation "creator_shop_period_gmv" does not exist' })).toBe(true);
  });

  it("error lain (RLS, jaringan) BUKAN dianggap migrasi belum ada", () => {
    expect(isMissingRelationError(null)).toBe(false);
    expect(isMissingRelationError({ code: "42501", message: "permission denied for table x" })).toBe(false);
    expect(isMissingRelationError({ message: "fetch failed" })).toBe(false);
  });
});

describe("migrasi 0087 — penjaga CLAUDE.md #9", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0087_shop_period_gmv_bizdev_handlers.sql"),
    "utf8"
  );

  it("setiap tabel baru punya restrictive deny is_creator_user()", () => {
    const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["creator_shop_period_gmv", "brand_bizdev_handlers"]);
    for (const t of [...tables, "brand_reports"]) {
      const re = new RegExp(`on ${t} as restrictive for select\\s+using \\(not is_creator_user\\(\\)\\)`);
      expect(sql, t).toMatch(re);
    }
  });

  it("view baru security_invoker (RLS pemanggil tetap berlaku)", () => {
    for (const v of ["shop_period_summary", "shop_key_map", "bizdev_brand_perf", "creator_shop_perf"]) {
      expect(sql).toMatch(new RegExp(`create or replace view ${v}\\s+with \\(security_invoker = on\\)`));
    }
  });

  it("tidak menyentuh constraint platform_alerts_alert_type_check (drift)", () => {
    expect(sql).not.toMatch(/alter table platform_alerts/);
  });
});

describe("migrasi 0088 — penjaga CLAUDE.md #9 & apply_migration (K23)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0088_shop_period_unattributed_all_shops.sql"),
    "utf8"
  );

  it("tabel baru punya restrictive deny is_creator_user()", () => {
    const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["creator_shop_period_unattributed_tap"]);
    expect(sql).toMatch(/on creator_shop_period_unattributed_tap as restrictive for select\s+using \(not is_creator_user\(\)\)/);
  });

  it("keempat view tetap security_invoker", () => {
    for (const v of ["shop_period_summary", "shop_key_map", "bizdev_brand_perf", "creator_shop_perf"]) {
      expect(sql).toMatch(new RegExp(`create or replace view ${v}\\s+with \\(security_invoker = on\\)`));
    }
  });

  it("tanpa DROP POLICY/TRIGGER (apply_migration menggantung, HANDOFF 2026-10-13)", () => {
    expect(sql).not.toMatch(/drop\s+(policy|trigger)/i);
  });
});

describe("migrasi 0089 — penjaga CLAUDE.md #9 & apply_migration (K23)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0089_unattributed_tap_scope_table.sql"),
    "utf8"
  );

  it("tabel lingkup baru punya restrictive deny is_creator_user()", () => {
    const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["creator_shop_period_unattributed_scope"]);
    expect(sql).toMatch(/on creator_shop_period_unattributed_scope as restrictive for select\s+using \(not is_creator_user\(\)\)/);
  });

  it("tanpa DROP apa pun (apply_migration menggantung, HANDOFF 2026-10-13 & 2026-10-15)", () => {
    expect(sql).not.toMatch(/^\s*drop\s/im);
  });
});

describe("migrasi 0090 — fungsi lookup kategori", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0090_product_category_lookup.sql"), "utf8");

  it("security invoker (RLS tabel dasar tetap berlaku) dan tanpa DROP", () => {
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/^\s*drop\s/im);
    expect(sql).not.toMatch(/create table/i);
  });
});

describe("migrasi 0092 — view grain-periode tanpa materialisasi penuh", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0092_shop_period_views_pushdown.sql"),
    "utf8"
  );

  it("kedua view tetap security_invoker", () => {
    for (const v of ["shop_period_summary", "creator_shop_perf"]) {
      expect(sql).toMatch(new RegExp(`create or replace view ${v}\\s+with \\(security_invoker = on\\)`));
    }
  });

  it("tidak ada CTE `base` yang dirujuk dua kali (penyebab materialisasi 766rb baris)", () => {
    expect(sql).not.toMatch(/with base as/);
  });

  it("kunci bulan memakai timestamp tanpa zona (immutable → bisa di-index)", () => {
    expect(sql).not.toMatch(/date_trunc\('month', [gub]\.period_start\)/);
    expect(sql).toMatch(/date_trunc\('month', period_start::timestamp\)::date/);
  });

  it("tanpa DROP POLICY/TRIGGER (K23)", () => {
    expect(sql).not.toMatch(/drop\s+(policy|trigger)/i);
  });
});

describe("migrasi 0093/0094 — kolom bulan & tabel ringkasan per shop", () => {
  const sql93 = readFileSync(join(process.cwd(), "supabase/migrations/0093_shop_period_month_column.sql"), "utf8");
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0094_shop_period_rollup.sql"), "utf8");

  it("tanpa DROP/DELETE apa pun (K23)", () => {
    for (const s of [sql93, sql]) {
      expect(s).not.toMatch(/^\s*drop\s/im);
      expect(s).not.toMatch(/^\s*delete\s/im);
    }
  });

  it("setiap tabel baru punya restrictive deny is_creator_user()", () => {
    const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["shop_period_rollup", "creator_shop_rollup", "shop_period_rollup_runs", "ingest_jobs"]);
    for (const t of tables) {
      expect(sql).toMatch(new RegExp(`on ${t} as restrictive for select\\s+using \\(not \\(select is_creator_user\\(\\)\\)\\)`));
    }
  });

  it("semua view security_invoker; view _live tertutup untuk anon/authenticated", () => {
    for (const v of ["shop_period_summary_live", "creator_shop_perf_live", "shop_period_summary", "creator_shop_perf"]) {
      expect(sql).toMatch(new RegExp(`create or replace view ${v}\\s+with \\(security_invoker = on\\)`));
    }
    expect(sql).toMatch(/revoke all on shop_period_summary_live from anon, authenticated/);
    expect(sql).toMatch(/revoke all on creator_shop_perf_live from anon, authenticated/);
  });

  it("fungsi refresh hanya bisa dieksekusi service_role", () => {
    for (const f of ["refresh_shop_period_rollup_slice", "finish_shop_period_rollup", "refresh_shop_period_rollup"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function ${f}\\([^)]*\\) from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function ${f}\\([^)]*\\) to service_role`));
    }
  });
});

describe("migrasi 0095 — antrean ringkasan per shop + job pg_cron", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0095_shop_period_rollup_queue.sql"), "utf8");

  it("tanpa DROP/DELETE apa pun (K23) — antrean ditandai processed_at, tidak dihapus", () => {
    expect(sql).not.toMatch(/^\s*drop\s/im);
    expect(sql).not.toMatch(/^\s*delete\s/im);
    expect(sql).toMatch(/update shop_period_rollup_queue set processed_at = v_seen\[i\]/);
  });

  it("tabel antrean punya restrictive deny is_creator_user()", () => {
    const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["shop_period_rollup_queue"]);
    expect(sql).toMatch(/on shop_period_rollup_queue as restrictive for select\s+using \(not \(select is_creator_user\(\)\)\)/);
  });

  it("trigger insert & delete di kedua tabel sumber", () => {
    for (const t of ["creator_shop_period_gmv", "creator_shop_period_unattributed_tap"]) {
      expect(sql).toMatch(new RegExp(`after insert on ${t}\\s+referencing new table as changed`));
      expect(sql).toMatch(new RegExp(`after delete on ${t}\\s+referencing old table as changed`));
    }
  });

  it("irisan pemroses = mask di refresh_shop_period_rollup_slice; generasi tidak mundur", () => {
    const fn = sql.slice(sql.indexOf("create or replace function refresh_shop_period_rollup_slice"));
    const masks = [...fn.matchAll(/hashtext\(l\.shop_id\) & (\d+)\) = p_slice\b/g)].map((m) => Number(m[1]));
    expect(masks).toEqual([127, 127]);
    expect(fn).toMatch(/p_slice > 127/);
    expect([...sql.matchAll(/for v_slice in 0\.\.(\d+) loop/g)].map((m) => Number(m[1]))).toEqual([127, 127]);
    expect(fn).toMatch(/refreshed_at = greatest\(shop_period_rollup\.refreshed_at, excluded\.refreshed_at\)/);
    expect(fn).toMatch(/refreshed_at = greatest\(creator_shop_rollup\.refreshed_at, excluded\.refreshed_at\)/);
  });

  it("pemroses hanya untuk service_role; job cron tanpa statement_timeout", () => {
    expect(sql).toMatch(/revoke all on function process_shop_period_rollup_queue\(interval\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function process_shop_period_rollup_queue\(interval\) to service_role/);
    expect(sql).toMatch(/revoke all on function enqueue_shop_period_rollup\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/'shop_period_rollup_queue', '\* \* \* \* \*',\s+'set statement_timeout = 0; select process_shop_period_rollup_queue\(\);'/);
  });
});

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

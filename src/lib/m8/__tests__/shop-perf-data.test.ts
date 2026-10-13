import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasLegacyPeriodData, loadPeriodView, periodKey } from "../shop-perf-data";
import { parsePeriodParam } from "../period";

function fake(result: { data?: unknown[]; error?: { code: string; message: string } | null; count?: number }) {
  const calls: [string, unknown][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lt"]) {
    q[m] = (a: string, b: unknown) => { calls.push([m, m === "select" ? a : [a, b]]); return q; };
  }
  q.range = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  q.then = (res: (v: unknown) => unknown) => res({ count: result.count ?? 0, error: null });
  return { client: { from: (t: string) => { calls.push(["from", t]); return q; } } as unknown as SupabaseClient, calls };
}

describe("shop-perf-data", () => {
  const month = parsePeriodParam("2026-09", "2026-10-13");
  const week = parsePeriodParam("2026-09-W3", "2026-10-13");

  it("periodKey: bulan → period_month, minggu → period_start", () => {
    expect(periodKey(month)).toEqual({ kind: "month", key: "2026-09-01" });
    expect(periodKey(week)).toEqual({ kind: "week", key: "2026-09-15" });
  });

  it("memfilter period_kind + period_key", async () => {
    const f = fake({ data: [{ a: 1 }] });
    const r = await loadPeriodView(f.client, "bizdev_brand_perf", "a", week);
    expect(r).toEqual({ rows: [{ a: 1 }], missing: false });
    expect(f.calls).toContainEqual(["eq", ["period_kind", "week"]]);
    expect(f.calls).toContainEqual(["eq", ["period_key", "2026-09-15"]]);
  });

  it("view belum ada → missing, tidak melempar", async () => {
    const f = fake({ error: { code: "PGRST205", message: "Could not find the table in the schema cache" } });
    expect(await loadPeriodView(f.client, "bizdev_brand_perf", "a", month)).toEqual({ rows: [], missing: true });
  });

  it("error lain tetap melempar", async () => {
    const f = fake({ error: { code: "42501", message: "permission denied" } });
    await expect(loadPeriodView(f.client, "bizdev_brand_perf", "a", month)).rejects.toThrow(/permission denied/);
  });

  it("hasLegacyPeriodData: bulan = rentang period_start [awal bulan, awal bulan berikut)", async () => {
    const f = fake({ count: 3 });
    expect(await hasLegacyPeriodData(f.client, month)).toBe(true);
    expect(f.calls).toContainEqual(["gte", ["period_start", "2026-09-01"]]);
    expect(f.calls).toContainEqual(["lt", ["period_start", "2026-10-01"]]);
  });
});

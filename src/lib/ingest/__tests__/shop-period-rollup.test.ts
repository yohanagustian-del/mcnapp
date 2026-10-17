import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshShopPeriodRollup, SHOP_PERIOD_SLICES } from "../shop-period-rollup";

type Call = { fn: string; args: Record<string, unknown> };

function mockAdmin(calls: Call[], fail?: (c: Call) => { code?: string; message: string } | null) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      const call = { fn, args };
      calls.push(call);
      return Promise.resolve({ error: fail?.(call) ?? null });
    },
  } as unknown as SupabaseClient;
}

describe("refreshShopPeriodRollup", () => {
  it("jumlah irisan = mask `& 31` di fungsi SQL 0094", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0094_shop_period_rollup.sql"), "utf8");
    const masks = [...sql.matchAll(/hashtext\([\w.]*shop_id\) & (\d+)/g)].map((m) => Number(m[1]));
    expect(masks.length).toBeGreaterThan(0);
    for (const m of masks) expect(m + 1).toBe(SHOP_PERIOD_SLICES);
    expect(sql).toMatch(new RegExp(`p_slice > ${SHOP_PERIOD_SLICES - 1}`));
  });

  it("2 grain × 32 irisan dengan satu generasi, lalu finish", async () => {
    const calls: Call[] = [];
    expect(await refreshShopPeriodRollup(mockAdmin(calls), "tiktok", "2026-09-29")).toBeNull();
    const slices = calls.filter((c) => c.fn === "refresh_shop_period_rollup_slice");
    expect(slices).toHaveLength(2 * SHOP_PERIOD_SLICES);
    const keys = new Set(slices.map((c) => `${c.args.p_grain}:${c.args.p_slice}`));
    expect(keys.size).toBe(2 * SHOP_PERIOD_SLICES);
    const gens = new Set(slices.map((c) => c.args.p_generation));
    expect(gens.size).toBe(1);
    expect(slices.every((c) => c.args.p_platform === "tiktok" && c.args.p_period_start === "2026-09-29")).toBe(true);
    const last = calls[calls.length - 1];
    expect(last).toEqual({
      fn: "finish_shop_period_rollup",
      args: { p_platform: "tiktok", p_period_start: "2026-09-29", p_generation: [...gens][0] },
    });
  });

  it("irisan yang gagal sekali dicoba ulang", async () => {
    const calls: Call[] = [];
    let failed = false;
    const res = await refreshShopPeriodRollup(
      mockAdmin(calls, (c) => {
        if (c.args.p_slice === 7 && c.args.p_grain === "month" && !failed) {
          failed = true;
          return { code: "57014", message: "canceling statement due to statement timeout" };
        }
        return null;
      }),
      "tiktok", "2026-09-29"
    );
    expect(res).toBeNull();
    expect(calls.filter((c) => c.fn === "refresh_shop_period_rollup_slice")).toHaveLength(2 * SHOP_PERIOD_SLICES + 1);
    expect(calls.at(-1)?.fn).toBe("finish_shop_period_rollup");
  });

  it("irisan gagal dua kali → catatan, generasi TIDAK diterbitkan", async () => {
    const calls: Call[] = [];
    const res = await refreshShopPeriodRollup(
      mockAdmin(calls, (c) => (c.args.p_slice === 3 ? { code: "57014", message: "statement timeout" } : null)),
      "shopee", "2026-10-08"
    );
    expect(res).toMatch(/gagal diperbarui/);
    expect(calls.some((c) => c.fn === "finish_shop_period_rollup")).toBe(false);
  });

  it("fungsi belum ada (migrasi 0094 belum di-apply) → catatan, tanpa crash", async () => {
    const calls: Call[] = [];
    const res = await refreshShopPeriodRollup(
      mockAdmin(calls, () => ({ code: "PGRST202", message: "Could not find the function public.refresh_shop_period_rollup_slice in the schema cache" })),
      "tiktok", "2026-09-29"
    );
    expect(res).toMatch(/Migrasi 0094/);
    expect(calls.some((c) => c.fn === "finish_shop_period_rollup")).toBe(false);
  });
});

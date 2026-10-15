import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fillMissingCategories, type CategoryRow } from "../category-fill";

type Lookup = Record<string, { level1_category: string | null; level2_category: string }>;

function mockAdmin(lookup: Lookup, calls: string[][], error: { code?: string; message: string } | null = null) {
  return {
    rpc: (fn: string, args: { p_product_ids: string[] }) => {
      expect(fn).toBe("product_category_lookup");
      calls.push(args.p_product_ids);
      const data = args.p_product_ids
        .filter((id) => lookup[id])
        .map((id) => ({ product_id: id, ...lookup[id] }));
      return Promise.resolve(error ? { data: null, error } : { data, error: null });
    },
  } as unknown as SupabaseClient;
}

const row = (productId: string, level2Category: string | null, affiliateGmv = 1000): CategoryRow => ({
  productId, affiliateGmv, level2Category, level1Category: null,
});

describe("fillMissingCategories (export tanpa kolom kategori, Sep 2026)", () => {
  it("fills only rows without a category; a category in the file always wins", async () => {
    const calls: string[][] = [];
    const rows = [row("P1", null), row("P2", "Skincare"), row("P3", null, 5000)];
    const tap = [row("P1", null), row("P4", null)];
    const res = await fillMissingCategories(
      mockAdmin({ P1: { level1_category: "Beauty", level2_category: "Makeup" }, P2: { level1_category: "X", level2_category: "Y" }, P4: { level1_category: null, level2_category: "Snack" } }, calls),
      rows, tap
    );
    expect(calls).toEqual([["P1", "P3", "P4"]]); // P2 already has a category → not looked up
    expect(rows.map((r) => r.level2Category)).toEqual(["Makeup", "Skincare", null]);
    expect(rows[0].level1Category).toBe("Beauty");
    expect(tap.map((r) => r.level2Category)).toEqual(["Makeup", "Snack"]);
    expect(res).toEqual({ rowsMissing: 2, rowsFilled: 1, gmvStillMissing: 5000, skipped: null });
  });

  it("no missing category → no lookup at all", async () => {
    const calls: string[][] = [];
    const res = await fillMissingCategories(mockAdmin({}, calls), [row("P1", "Makeup")]);
    expect(calls).toHaveLength(0);
    expect(res.rowsMissing).toBe(0);
  });

  it("function not deployed yet (0090) → reported, rows left as they are, no throw", async () => {
    const rows = [row("P1", null)];
    const res = await fillMissingCategories(
      mockAdmin({}, [], { code: "PGRST202", message: "Could not find the function public.product_category_lookup in the schema cache" }),
      rows
    );
    expect(res.skipped).toMatch(/migrasi 0090/);
    expect(rows[0].level2Category).toBeNull();
  });

  it("other errors throw (ingest must not silently lose categories)", async () => {
    await expect(
      fillMissingCategories(mockAdmin({}, [], { code: "57014", message: "statement timeout" }), [row("P1", null)])
    ).rejects.toThrow(/statement timeout/);
  });
});

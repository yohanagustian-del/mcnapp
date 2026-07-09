import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertDerivedFromTap, type TapProductRow } from "../products";

// getConfig("segments.price_bounds") is the only external dependency of
// upsertDerivedFromTap — stub it so tests don't touch the DB/config table.
vi.mock("@/lib/config", () => ({
  getConfig: vi.fn(async () =>
    ({ low: 180_000, entry: 800_000, sweet: 3_600_000, high: 8_000_000 })
  ),
}));

const WEEK = "2026-06-28";

interface ExistingRow {
  product_id: string;
  source: string | null;
  first_seen: string | null;
  shop_id: string;
}

interface Counts {
  selectCalls: number;
  upsertCalls: number;
  upsertedRows: unknown[];
}

/**
 * Recording mock: `.from(t).select(...).in(col, chunk)` resolves to the subset of
 * `existing` whose product_id is in the chunk; `.from(t).upsert(rows, opts)`
 * records the rows. Both increment call counters so tests can assert the query
 * count does NOT scale with the number of products (no N+1).
 *
 * `upsertError`, when provided, makes every upsert call resolve with that error
 * (used to assert the upsert-failure path surfaces via console.error + return
 * value instead of being silently swallowed).
 */
function mockSupabase(
  existing: ExistingRow[],
  counts: Counts,
  upsertError: { message: string } | null = null
): SupabaseClient {
  const byId = new Map(existing.map((r) => [r.product_id, r]));
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, chunk: string[]) => {
          counts.selectCalls++;
          const data = chunk
            .map((id) => byId.get(id))
            .filter((r): r is ExistingRow => r != null)
            .map((r) => ({
              product_id: r.product_id,
              source: r.source,
              first_seen: r.first_seen,
              shop_id: r.shop_id,
            }));
          return Promise.resolve({ data, error: null });
        },
      }),
      upsert: (rows: unknown[]) => {
        counts.upsertCalls++;
        if (upsertError) return Promise.resolve({ error: upsertError });
        if (Array.isArray(rows)) counts.upsertedRows.push(...rows);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
}

function tapProduct(overrides: Partial<TapProductRow> = {}): TapProductRow {
  return {
    product_id: "P1",
    product_name: "Produk A",
    shop_id: "S1",
    shop_name: "Toko A",
    level2_category: "Drinks",
    affiliate_gmv: 1_000_000,
    items_sold: 10,
    ...overrides,
  };
}

describe("upsertDerivedFromTap (bulk, no N+1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never clobbers master_upload rows — re-asserts source and only bumps last_seen", async () => {
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    const existing: ExistingRow[] = [
      { product_id: "P1", source: "master_upload", first_seen: "2026-01-01", shop_id: "S1" },
    ];
    const rows = [tapProduct({ product_id: "P1" })];
    const res = await upsertDerivedFromTap(mockSupabase(existing, counts), rows, WEEK);

    expect(res).toEqual({ upserted: 1, skipped: 0, errors: [] });
    const upserted = counts.upsertedRows[0] as Record<string, unknown>;
    // master row: source stays master_upload, no derived price/name columns sent,
    // last_seen bumped to this week.
    expect(upserted.source).toBe("master_upload");
    expect(upserted.last_seen).toBe(WEEK);
    expect(upserted.price).toBeUndefined();
    expect(upserted.product_name).toBeUndefined();
  });

  it("includes shop_id (existing value) in the master-refresh payload — required by products_tap.shop_id NOT NULL", async () => {
    // Regression test: products_tap.shop_id is `text not null` with no default
    // (supabase/migrations/0019_products_tap.sql). A master-refresh upsert that
    // omits shop_id always fails PostgREST's INSERT-branch validation even when
    // the row already exists and only the UPDATE branch runs. Re-sending the
    // existing shop_id satisfies the constraint without clobbering other columns.
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    const existing: ExistingRow[] = [
      { product_id: "P1", source: "master_upload", first_seen: "2026-01-01", shop_id: "S1" },
    ];
    const rows = [tapProduct({ product_id: "P1", shop_id: "S1" })];
    await upsertDerivedFromTap(mockSupabase(existing, counts), rows, WEEK);

    const upserted = counts.upsertedRows[0] as Record<string, unknown>;
    expect(upserted.shop_id).toBe("S1");
  });

  it("preserves existing first_seen for both master and derived rows", async () => {
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    const existing: ExistingRow[] = [
      { product_id: "P1", source: "master_upload", first_seen: "2026-01-01", shop_id: "S1" },
      { product_id: "P2", source: "derived_tap", first_seen: "2026-02-02", shop_id: "S2" },
    ];
    const rows = [tapProduct({ product_id: "P1" }), tapProduct({ product_id: "P2" })];
    await upsertDerivedFromTap(mockSupabase(existing, counts), rows, WEEK);

    const byId = new Map(
      counts.upsertedRows.map((r) => [(r as { product_id: string }).product_id, r as Record<string, unknown>])
    );
    expect(byId.get("P1")?.first_seen).toBe("2026-01-01");
    expect(byId.get("P2")?.first_seen).toBe("2026-02-02");
  });

  it("uses week as first_seen for a brand-new derived product", async () => {
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    const rows = [tapProduct({ product_id: "PNEW", affiliate_gmv: 500_000, items_sold: 5 })];
    await upsertDerivedFromTap(mockSupabase([], counts), rows, WEEK);

    const row = counts.upsertedRows[0] as Record<string, unknown>;
    expect(row.source).toBe("derived_tap");
    expect(row.first_seen).toBe(WEEK);
    expect(row.price).toBe(100_000); // 500_000 / 5
    expect(row.price_segment).toBe("low"); // < 180_000
  });

  it("dedups the same product across multiple TAP rows (sums gmv/items for the price estimate)", async () => {
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    const rows = [
      tapProduct({ product_id: "P1", affiliate_gmv: 300_000, items_sold: 1 }),
      tapProduct({ product_id: "P1", affiliate_gmv: 300_000, items_sold: 1 }),
      tapProduct({ product_id: "P1", affiliate_gmv: 400_000, items_sold: 2 }),
    ];
    const res = await upsertDerivedFromTap(mockSupabase([], counts), rows, WEEK);

    // 3 input rows collapse to 1 product → 1 upserted row.
    expect(res.upserted).toBe(1);
    expect(counts.upsertedRows).toHaveLength(1);
    const row = counts.upsertedRows[0] as Record<string, unknown>;
    // (300k + 300k + 400k) / (1 + 1 + 2) = 250_000
    expect(row.price).toBe(250_000);
  });

  it("query count does NOT scale with the number of products (no N+1)", async () => {
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    // 450 distinct products → old code = 450 selects + 450 upserts (900 round-trips).
    // Bulk code = ceil(450/200)=3 selects + ceil(450/500)=1 upsert = 4 round-trips.
    const rows: TapProductRow[] = Array.from({ length: 450 }, (_, i) =>
      tapProduct({ product_id: `P${i}`, affiliate_gmv: 200_000, items_sold: 1 })
    );
    const res = await upsertDerivedFromTap(mockSupabase([], counts), rows, WEEK);

    expect(res.upserted).toBe(450);
    expect(counts.selectCalls).toBe(3);
    expect(counts.upsertCalls).toBe(1);
    // Total round-trips must stay far below the product count.
    expect(counts.selectCalls + counts.upsertCalls).toBeLessThan(10);
  });

  it("skips rows missing product_id or shop_id", async () => {
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    const rows = [
      tapProduct({ product_id: "", shop_id: "S1" }),
      tapProduct({ product_id: "P1", shop_id: "" }),
      tapProduct({ product_id: "P2", shop_id: "S2" }),
    ];
    const res = await upsertDerivedFromTap(mockSupabase([], counts), rows, WEEK);
    expect(res.skipped).toBe(2);
    expect(res.upserted).toBe(1);
  });

  it("surfaces upsert errors via console.error and the return value, instead of silently swallowing them", async () => {
    // Regression test: the old code did `if (error) skipped += chunk.length;`
    // with no logging and no way for the caller to know a write failed.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const counts: Counts = { selectCalls: 0, upsertCalls: 0, upsertedRows: [] };
    const rows = [tapProduct({ product_id: "PNEW", affiliate_gmv: 500_000, items_sold: 5 })];
    const res = await upsertDerivedFromTap(
      mockSupabase([], counts, { message: "null value in column \"shop_id\" violates not-null constraint" }),
      rows,
      WEEK
    );

    expect(res.upserted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("shop_id");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("upsertDerivedFromTap");
    consoleErrorSpy.mockRestore();
  });
});

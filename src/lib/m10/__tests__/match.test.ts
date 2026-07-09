import { describe, expect, it } from "vitest";
import {
  creatorSegmentMap,
  matchCreatorsForProduct,
  matchProductsForCreator,
  type CreatorMatrixEntry,
  type CreatorSegmentRow,
  type ProductRow,
} from "../match";

const rows: CreatorSegmentRow[] = [
  { level2_category: "Skincare Serum", price_segment: "entry", gmv: 15_000_000, live_gmv: 9_000_000, items_sold: 100, avg_price: null },
  { level2_category: "Skincare Serum", price_segment: "sweet", gmv: 5_000_000, live_gmv: 1_000_000, items_sold: 5, avg_price: null },
  { level2_category: "Lip Tint", price_segment: "low", gmv: 5_000_000, live_gmv: 5_000_000, items_sold: 500, avg_price: null },
];

const product = (over: Partial<ProductRow>): ProductRow => ({
  productId: "P-1",
  productName: "Serum X",
  shopId: "S-1",
  shopName: "Toko X",
  level2Category: "Skincare Serum",
  priceSegment: "entry",
  price: 300_000,
  commissionPct: 10,
  ...over,
});

describe("creatorSegmentMap", () => {
  it("builds cells with GMV share relative to total across all cells", () => {
    const matrix = creatorSegmentMap(rows);
    expect(matrix.totalGmv).toBe(25_000_000);
    const serumEntry = matrix.cells.get("skincare serum|entry");
    expect(serumEntry?.gmv).toBe(15_000_000);
    expect(serumEntry?.share).toBeCloseTo(15_000_000 / 25_000_000);
  });

  it("computes avg_price from gmv/items when avg_price column is null", () => {
    const matrix = creatorSegmentMap(rows);
    const serumEntry = matrix.cells.get("skincare serum|entry");
    expect(serumEntry?.avgPrice).toBe(150_000);
  });

  it("excludes rows without a resolved price_segment from cells (still counts in byCategory)", () => {
    const withNullSegment: CreatorSegmentRow[] = [
      ...rows,
      { level2_category: "Skincare Serum", price_segment: null, gmv: 2_000_000, live_gmv: 0, items_sold: 0, avg_price: null },
    ];
    const matrix = creatorSegmentMap(withNullSegment);
    expect(matrix.byCategory.get("skincare serum")).toBe(15_000_000 + 5_000_000 + 2_000_000);
    // cells unaffected — the null-segment row contributes nothing to any cell
    expect(matrix.cells.get("skincare serum|entry")?.gmv).toBe(15_000_000);
  });

  it("ignores non-positive gmv rows entirely", () => {
    const matrix = creatorSegmentMap([
      { level2_category: "Fashion", price_segment: "low", gmv: 0, live_gmv: 0, items_sold: 0, avg_price: null },
    ]);
    expect(matrix.totalGmv).toBe(0);
    expect(matrix.cells.size).toBe(0);
  });
});

describe("matchProductsForCreator", () => {
  it("ranks an exact (category, segment) cell match with reason exact_cell", () => {
    const matrix = creatorSegmentMap(rows);
    const results = matchProductsForCreator(matrix, [product({})], 10);
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe("exact_cell");
    expect(results[0].matchedSegment).toBe("entry");
    expect(results[0].score).toBeCloseTo(15_000_000 / 25_000_000);
  });

  it("falls back to an adjacent segment (halved score) when the exact cell is empty", () => {
    const matrix = creatorSegmentMap(rows); // has "skincare serum|sweet" and "|entry", not "|high"
    const results = matchProductsForCreator(matrix, [product({ priceSegment: "high" })], 10);
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe("adjacent_segment");
    // adjacent to "high" is "sweet" (5m) — should pick sweet over nothing
    expect(results[0].matchedSegment).toBe("sweet");
    expect(results[0].score).toBeCloseTo((5_000_000 / 25_000_000) * 0.5);
  });

  it("prefers the best adjacent segment when both neighbors have data", () => {
    const matrix = creatorSegmentMap(rows); // entry=15m, sweet=5m around "sweet" neighbors
    const results = matchProductsForCreator(
      matrix,
      [product({ level2Category: "Skincare Serum", priceSegment: "sweet" })],
      10
    );
    // sweet itself has a cell (5m) → exact_cell should win over adjacent
    expect(results[0].reason).toBe("exact_cell");
    expect(results[0].matchedSegment).toBe("sweet");
  });

  it("drops products with no exact or adjacent match at all", () => {
    const matrix = creatorSegmentMap(rows);
    const results = matchProductsForCreator(
      matrix,
      [product({ level2Category: "Elektronik", priceSegment: "premium" })],
      10
    );
    expect(results).toHaveLength(0);
  });

  it("drops products missing category or price segment", () => {
    const matrix = creatorSegmentMap(rows);
    const results = matchProductsForCreator(
      matrix,
      [product({ level2Category: null }), product({ priceSegment: null })],
      10
    );
    expect(results).toHaveLength(0);
  });

  it("ranks results descending by score and respects topN", () => {
    const matrix = creatorSegmentMap(rows);
    const results = matchProductsForCreator(
      matrix,
      [
        product({ productId: "P-lip", level2Category: "Lip Tint", priceSegment: "low" }),
        product({ productId: "P-serum", level2Category: "Skincare Serum", priceSegment: "entry" }),
      ],
      1
    );
    expect(results).toHaveLength(1);
    // Lip Tint low share = 5m/25m = 0.2; Skincare Serum entry share = 15m/25m = 0.6 → serum wins
    expect(results[0].product.productId).toBe("P-serum");
  });
});

describe("matchCreatorsForProduct", () => {
  const entryA: CreatorMatrixEntry = {
    creatorId: "CRT-A",
    creatorName: "Creator A",
    matrix: creatorSegmentMap(rows),
  };
  const entryB: CreatorMatrixEntry = {
    creatorId: "CRT-B",
    creatorName: "Creator B",
    matrix: creatorSegmentMap([
      { level2_category: "Skincare Serum", price_segment: "entry", gmv: 40_000_000, live_gmv: 0, items_sold: 200, avg_price: null },
    ]),
  };

  it("ranks creators by GMV share in the matching cell, best first", () => {
    const results = matchCreatorsForProduct(product({}), [entryA, entryB], 10);
    expect(results.map((r) => r.creatorId)).toEqual(["CRT-B", "CRT-A"]);
    expect(results[0].reason).toBe("exact_cell");
  });

  it("returns empty when the product has no category or segment", () => {
    expect(matchCreatorsForProduct(product({ level2Category: null }), [entryA, entryB], 10)).toHaveLength(0);
    expect(matchCreatorsForProduct(product({ priceSegment: null }), [entryA, entryB], 10)).toHaveLength(0);
  });

  it("respects topN", () => {
    const results = matchCreatorsForProduct(product({}), [entryA, entryB], 1);
    expect(results).toHaveLength(1);
    expect(results[0].creatorId).toBe("CRT-B");
  });
});

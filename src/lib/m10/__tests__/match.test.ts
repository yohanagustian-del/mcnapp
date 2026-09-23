import { describe, expect, it } from "vitest";
import { creatorSegmentMap, type CreatorSegmentRow } from "../match";

const rows: CreatorSegmentRow[] = [
  { level2_category: "Skincare Serum", price_segment: "entry", gmv: 15_000_000, live_gmv: 9_000_000, items_sold: 100, avg_price: null },
  { level2_category: "Skincare Serum", price_segment: "sweet", gmv: 5_000_000, live_gmv: 1_000_000, items_sold: 5, avg_price: null },
  { level2_category: "Lip Tint", price_segment: "low", gmv: 5_000_000, live_gmv: 5_000_000, items_sold: 500, avg_price: null },
];

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

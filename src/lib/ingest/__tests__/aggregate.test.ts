import { describe, expect, it } from "vitest";
import { buildPeriodSummary, buildSubcatSegment, buildTopProducts } from "../aggregate";
import type { McnRow } from "../schema";
import type { PriceBounds } from "@/lib/projection/gmv";

const BOUNDS: PriceBounds = { low: 180_000, entry: 800_000, sweet: 3_600_000, high: 8_000_000 };

function row(overrides: Partial<McnRow>): McnRow {
  return {
    date: "2026-06-28-2026-07-04",
    periodStart: "2026-06-28",
    periodEnd: "2026-06-28",
    creatorName: "CRT-001",
    followerCount: null,
    productId: "P1",
    productInfo: "Produk A",
    shopId: "S1",
    shopName: "Toko A",
    level1Category: "Cat1",
    level2Category: "Cat2",
    affiliateGmv: 0,
    affiliateLiveGmv: 0,
    affiliateVideoGmv: 0,
    orders: 0,
    liveOrders: 0,
    videoOrders: 0,
    directGmv: 0,
    itemsSold: 0,
    refundGmv: 0,
    ctr: null,
    ctor: null,
    ...overrides,
  };
}

describe("buildPeriodSummary", () => {
  it("sums metrics for a single creator across multiple days", () => {
    const rows = [
      row({ periodStart: "2026-06-28", periodEnd: "2026-06-28", affiliateGmv: 1_000_000, affiliateLiveGmv: 600_000, affiliateVideoGmv: 400_000, orders: 10, itemsSold: 5 }),
      row({ periodStart: "2026-06-29", periodEnd: "2026-06-29", affiliateGmv: 2_000_000, affiliateLiveGmv: 1_000_000, affiliateVideoGmv: 1_000_000, orders: 20, itemsSold: 10 }),
    ];
    const [summary] = buildPeriodSummary(rows);
    expect(summary.creatorId).toBe("CRT-001");
    expect(summary.affiliateGmv).toBe(3_000_000);
    expect(summary.affiliateLiveGmv).toBe(1_600_000);
    expect(summary.affiliateVideoGmv).toBe(1_400_000);
    expect(summary.orders).toBe(30);
    expect(summary.itemsSold).toBe(15);
    expect(summary.gmvTotal).toBe(3_000_000);
    // period range spans both days
    expect(summary.periodStart).toBe("2026-06-28");
    expect(summary.periodEnd).toBe("2026-06-29");
  });

  it("computes live_pct = live_gmv / gmv", () => {
    const rows = [row({ affiliateGmv: 1_000_000, affiliateLiveGmv: 400_000 })];
    const [summary] = buildPeriodSummary(rows);
    expect(summary.livePct).toBeCloseTo(0.4);
  });

  it("guards live_pct div-by-zero (gmv=0 -> null)", () => {
    const rows = [row({ affiliateGmv: 0, affiliateLiveGmv: 0 })];
    const [summary] = buildPeriodSummary(rows);
    expect(summary.livePct).toBeNull();
  });

  it("computes ctr/ctor as GMV-weighted averages", () => {
    // Row A: gmv 1jt, ctr 10%; Row B: gmv 3jt, ctr 20% -> weighted = (1*10 + 3*20)/4 = 17.5
    const rows = [
      row({ affiliateGmv: 1_000_000, ctr: 10, ctor: 5 }),
      row({ affiliateGmv: 3_000_000, ctr: 20, ctor: 15 }),
    ];
    const [summary] = buildPeriodSummary(rows);
    expect(summary.ctr).toBeCloseTo(17.5);
    expect(summary.ctor).toBeCloseTo((1_000_000 * 5 + 3_000_000 * 15) / 4_000_000);
  });

  it("keeps separate creators separate", () => {
    const rows = [
      row({ creatorName: "CRT-001", affiliateGmv: 1_000_000 }),
      row({ creatorName: "CRT-002", affiliateGmv: 2_000_000 }),
    ];
    const summaries = buildPeriodSummary(rows);
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.creatorId === "CRT-001")?.affiliateGmv).toBe(1_000_000);
    expect(summaries.find((s) => s.creatorId === "CRT-002")?.affiliateGmv).toBe(2_000_000);
  });
});

describe("buildSubcatSegment", () => {
  it("classifies segment boundaries exactly at the thresholds (low/entry/sweet/high)", () => {
    // priceSegmentOf uses `< bound` per segment, so avg_price exactly at a bound
    // belongs to the NEXT segment up (Module 5 §2.1.1 semantics, shared w/ M5/M6).
    const cases: [number, string][] = [
      [179_999, "low"],
      [180_000, "entry"],
      [799_999, "entry"],
      [800_000, "sweet"],
      [3_599_999, "sweet"],
      [3_600_000, "high"],
      [7_999_999, "high"],
      [8_000_000, "premium"],
    ];
    for (const [price, expected] of cases) {
      const rows = [row({ creatorName: `CRT-${price}`, affiliateGmv: price, itemsSold: 1 })];
      const [seg] = buildSubcatSegment(rows, BOUNDS);
      expect(seg.priceSegment, `price ${price}`).toBe(expected);
    }
  });

  it("items_sold=0 -> segment null, gmv still counted", () => {
    const rows = [row({ affiliateGmv: 500_000, itemsSold: 0 })];
    const [seg] = buildSubcatSegment(rows, BOUNDS);
    expect(seg.priceSegment).toBeNull();
    expect(seg.gmv).toBe(500_000);
    expect(seg.avgPrice).toBeNull();
  });

  it("groups by (creator, level2 category, segment) and sums", () => {
    const rows = [
      row({ level2Category: "Drinks", affiliateGmv: 100_000, itemsSold: 1 }), // low
      row({ level2Category: "Drinks", affiliateGmv: 100_000, itemsSold: 1 }), // low, same bucket
      row({ level2Category: "Drinks", affiliateGmv: 5_000_000, itemsSold: 1 }), // high
      row({ level2Category: "Snacks", affiliateGmv: 100_000, itemsSold: 1 }), // low, different category
    ];
    const segs = buildSubcatSegment(rows, BOUNDS);
    expect(segs).toHaveLength(3);
    const drinksLow = segs.find((s) => s.level2Category === "Drinks" && s.priceSegment === "low");
    expect(drinksLow?.gmv).toBe(200_000);
    expect(drinksLow?.itemsSold).toBe(2);
    const drinksHigh = segs.find((s) => s.level2Category === "Drinks" && s.priceSegment === "high");
    expect(drinksHigh?.gmv).toBe(5_000_000);
    const snacksLow = segs.find((s) => s.level2Category === "Snacks");
    expect(snacksLow?.gmv).toBe(100_000);
  });

  it("computes group avg_price = sum(gmv) / sum(items_sold) (PRD §2.3)", () => {
    // Both rows have per-product avg 100k -> same (low) bucket.
    // Group avg = (200k + 100k) / (2 + 1) = 100k.
    const rows = [
      row({ productId: "P1", affiliateGmv: 200_000, itemsSold: 2 }),
      row({ productId: "P2", affiliateGmv: 100_000, itemsSold: 1 }),
    ];
    const segs = buildSubcatSegment(rows, BOUNDS);
    expect(segs).toHaveLength(1);
    expect(segs[0].priceSegment).toBe("low");
    expect(segs[0].avgPrice).toBe(100_000);
  });

  it("splits rows with different per-product avg prices into separate segment buckets", () => {
    // P1 avg 100k -> low; P2 avg 200k -> entry (>=180k bound).
    const rows = [
      row({ productId: "P1", affiliateGmv: 200_000, itemsSold: 2 }),
      row({ productId: "P2", affiliateGmv: 400_000, itemsSold: 2 }),
    ];
    const segs = buildSubcatSegment(rows, BOUNDS);
    expect(segs).toHaveLength(2);
    expect(segs.find((s) => s.priceSegment === "low")?.gmv).toBe(200_000);
    expect(segs.find((s) => s.priceSegment === "entry")?.gmv).toBe(400_000);
  });
});

describe("buildTopProducts", () => {
  it("sums a product's GMV across multiple days before ranking", () => {
    const rows = [
      row({ productId: "P1", periodStart: "2026-06-28", periodEnd: "2026-06-28", affiliateGmv: 1_000_000 }),
      row({ productId: "P1", periodStart: "2026-06-29", periodEnd: "2026-06-29", affiliateGmv: 2_000_000 }),
    ];
    const [top] = buildTopProducts(rows, 20);
    expect(top.gmv).toBe(3_000_000);
    expect(top.periodStart).toBe("2026-06-28");
    expect(top.periodEnd).toBe("2026-06-29");
  });

  it("ranks products by gmv desc per creator", () => {
    const rows = [
      row({ productId: "P1", affiliateGmv: 1_000_000 }),
      row({ productId: "P2", affiliateGmv: 5_000_000 }),
      row({ productId: "P3", affiliateGmv: 3_000_000 }),
    ];
    const top = buildTopProducts(rows, 20);
    expect(top.map((t) => t.productId)).toEqual(["P2", "P3", "P1"]);
    expect(top.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it("cuts off at topN and discards the rest", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ productId: `P${i}`, affiliateGmv: (25 - i) * 1000 })
    );
    const top = buildTopProducts(rows, 20);
    expect(top).toHaveLength(20);
    expect(top[0].productId).toBe("P0");
    expect(top.at(-1)?.productId).toBe("P19");
  });

  it("keeps top-N independent per creator", () => {
    const rows = [
      row({ creatorName: "CRT-A", productId: "P1", affiliateGmv: 1_000_000 }),
      row({ creatorName: "CRT-B", productId: "P2", affiliateGmv: 500_000 }),
    ];
    const top = buildTopProducts(rows, 1);
    expect(top).toHaveLength(2);
    expect(top.find((t) => t.creatorId === "CRT-A")?.productId).toBe("P1");
    expect(top.find((t) => t.creatorId === "CRT-B")?.productId).toBe("P2");
  });
});

import { describe, expect, it } from "vitest";
import { buildShopeePeriodSummary, buildShopeeSubcatSegment, shopeeRowSegment } from "../shopee-aggregate";
import type { ShopeeRow } from "../shopee-csv";
import type { PriceBounds } from "@/lib/projection/gmv";

// Same shape as app_config segments.price_bounds (low<180k, entry<800k, sweet<3.6jt, high<8jt).
const BOUNDS: PriceBounds = { low: 180_000, entry: 800_000, sweet: 3_600_000, high: 8_000_000 };

function shopeeRow(overrides: Partial<ShopeeRow> = {}): ShopeeRow {
  return {
    orderDate: "2026-07-03",
    affiliateName: "Affiliate A",
    affiliateUsername: "CRT-001", // resolved id, per aggregate.ts convention
    productId: "P1",
    productName: "Produk A",
    shopId: "S1",
    shopName: "Toko A",
    level1Category: "Cat1",
    level2Category: "Cat2",
    gmv: 100_000,
    qty: null,
    unitPrice: null,
    platform: "Shopeelive-Shopee",
    bucket: "live",
    ...overrides,
  };
}

describe("buildShopeePeriodSummary", () => {
  it("sums gmv_total across all rows regardless of bucket", () => {
    const rows = [
      shopeeRow({ gmv: 100_000, bucket: "live" }),
      shopeeRow({ gmv: 50_000, bucket: "video" }),
      shopeeRow({ gmv: 10_000, bucket: "other", platform: "WhatsApp" }),
    ];
    const [summary] = buildShopeePeriodSummary(rows, "2026-07-01", "2026-07-07");
    expect(summary.gmvTotal).toBe(160_000);
  });

  it("splits affiliate_live_gmv and affiliate_video_gmv by bucket, other stays out of both", () => {
    const rows = [
      shopeeRow({ gmv: 100_000, bucket: "live" }),
      shopeeRow({ gmv: 50_000, bucket: "video" }),
      shopeeRow({ gmv: 10_000, bucket: "other" }),
    ];
    const [summary] = buildShopeePeriodSummary(rows, "2026-07-01", "2026-07-07");
    expect(summary.affiliateLiveGmv).toBe(100_000);
    expect(summary.affiliateVideoGmv).toBe(50_000);
  });

  it("groups by creator (resolved id) separately", () => {
    const rows = [
      shopeeRow({ affiliateUsername: "CRT-001", gmv: 100_000 }),
      shopeeRow({ affiliateUsername: "CRT-002", gmv: 200_000 }),
    ];
    const summary = buildShopeePeriodSummary(rows, "2026-07-01", "2026-07-07");
    expect(summary).toHaveLength(2);
    const byCreator = new Map(summary.map((s) => [s.creatorId, s]));
    expect(byCreator.get("CRT-001")?.gmvTotal).toBe(100_000);
    expect(byCreator.get("CRT-002")?.gmvTotal).toBe(200_000);
  });

  it("counts orders as row count (one row = one order-line, unlike TikTok's pre-aggregate)", () => {
    const rows = [shopeeRow(), shopeeRow(), shopeeRow()];
    const [summary] = buildShopeePeriodSummary(rows, "2026-07-01", "2026-07-07");
    expect(summary.orders).toBe(3);
  });

  it("stamps periodStart/periodEnd from the caller-supplied window boundaries", () => {
    const [summary] = buildShopeePeriodSummary([shopeeRow()], "2026-07-01", "2026-07-07");
    expect(summary.periodStart).toBe("2026-07-01");
    expect(summary.periodEnd).toBe("2026-07-07");
  });

  it("returns an empty array for no rows", () => {
    expect(buildShopeePeriodSummary([], "2026-07-01", "2026-07-07")).toEqual([]);
  });
});

describe("buildShopeeSubcatSegment", () => {
  it("groups by (creator, normalized category), summing gmv and counting orders", () => {
    const rows = [
      shopeeRow({ level2Category: "Dress", gmv: 100_000 }),
      shopeeRow({ level2Category: "dress", gmv: 50_000 }), // different casing, same category
    ];
    const segments = buildShopeeSubcatSegment(rows, "2026-07-07", BOUNDS);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ level2Category: "Dress", gmv: 150_000, orders: 2 });
  });

  it("sums liveGmv only from bucket='live' rows; without Qty/Harga the segment stays null (not guessed)", () => {
    const rows = [
      shopeeRow({ level2Category: "Dress", gmv: 100_000, bucket: "live" }),
      shopeeRow({ level2Category: "Dress", gmv: 50_000, bucket: "video" }),
    ];
    const [segment] = buildShopeeSubcatSegment(rows, "2026-07-07", BOUNDS);
    expect(segment.gmv).toBe(150_000);
    expect(segment.liveGmv).toBe(100_000);
    expect(segment.priceSegment).toBeNull();
    expect(segment.itemsSold).toBe(0);
    expect(segment.avgPrice).toBeNull();
  });

  it("excludes rows whose category isn't in the official Shopee list, rather than guessing", () => {
    const rows = [
      shopeeRow({ level2Category: "Dress", gmv: 100_000 }),
      shopeeRow({ level2Category: "Kategori Karangan", gmv: 999_999 }),
      shopeeRow({ level2Category: null, gmv: 999_999 }),
    ];
    const segments = buildShopeeSubcatSegment(rows, "2026-07-07", BOUNDS);
    expect(segments).toHaveLength(1);
    expect(segments[0].gmv).toBe(100_000);
  });

  it("separates categories per creator", () => {
    const rows = [
      shopeeRow({ affiliateUsername: "CRT-001", level2Category: "Dress", gmv: 100_000 }),
      shopeeRow({ affiliateUsername: "CRT-002", level2Category: "Dress", gmv: 200_000 }),
    ];
    const segments = buildShopeeSubcatSegment(rows, "2026-07-07", BOUNDS);
    expect(segments).toHaveLength(2);
    const byCreator = new Map(segments.map((s) => [s.creatorId, s]));
    expect(byCreator.get("CRT-001")?.gmv).toBe(100_000);
    expect(byCreator.get("CRT-002")?.gmv).toBe(200_000);
  });

  it("returns an empty array for no rows", () => {
    expect(buildShopeeSubcatSegment([], "2026-07-07", BOUNDS)).toEqual([]);
  });

  it("derives the segment per order-line from Harga(Rp) and makes it part of the group key", () => {
    const rows = [
      shopeeRow({ level2Category: "Dress", gmv: 150_000, qty: 1, unitPrice: 150_000 }), // low
      shopeeRow({ level2Category: "Dress", gmv: 600_000, qty: 2, unitPrice: 300_000 }), // entry
      shopeeRow({ level2Category: "Dress", gmv: 300_000, qty: 1, unitPrice: 300_000 }), // entry
    ];
    const segments = buildShopeeSubcatSegment(rows, "2026-07-07", BOUNDS);
    const bySeg = new Map(segments.map((s) => [s.priceSegment, s]));
    expect(segments).toHaveLength(2);
    expect(bySeg.get("low")).toMatchObject({ gmv: 150_000, itemsSold: 1, orders: 1, avgPrice: 150_000 });
    expect(bySeg.get("entry")).toMatchObject({ gmv: 900_000, itemsSold: 3, orders: 2, avgPrice: 300_000 });
  });

  it("falls back to gmv/Qty when Harga(Rp) is unreadable", () => {
    const [seg] = buildShopeeSubcatSegment(
      [shopeeRow({ level2Category: "Dress", gmv: 1_000_000, qty: 2, unitPrice: null })],
      "2026-07-07",
      BOUNDS
    );
    expect(seg.priceSegment).toBe("entry"); // 500k/item
    expect(seg.itemsSold).toBe(2);
  });
});

describe("shopeeRowSegment", () => {
  it("Harga(Rp) wins over gmv/Qty; neither readable → null", () => {
    expect(shopeeRowSegment(shopeeRow({ unitPrice: 9_000_000, qty: 10, gmv: 100 }), BOUNDS)).toBe("premium");
    expect(shopeeRowSegment(shopeeRow({ unitPrice: null, qty: 4, gmv: 4_000_000 }), BOUNDS)).toBe("sweet");
    expect(shopeeRowSegment(shopeeRow({ unitPrice: null, qty: null }), BOUNDS)).toBeNull();
  });
});

describe("buildShopeePeriodSummary itemsSold", () => {
  it("sums readable Qty only (blank Qty adds 0, not 1)", () => {
    const [summary] = buildShopeePeriodSummary(
      [shopeeRow({ qty: 3 }), shopeeRow({ qty: null }), shopeeRow({ qty: 2 })],
      "2026-07-01",
      "2026-07-07"
    );
    expect(summary.itemsSold).toBe(5);
    expect(summary.orders).toBe(3);
  });
});

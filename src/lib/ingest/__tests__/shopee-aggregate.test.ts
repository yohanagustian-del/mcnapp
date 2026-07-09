import { describe, expect, it } from "vitest";
import { buildShopeePeriodSummary } from "../shopee-aggregate";
import type { ShopeeRow } from "../shopee-csv";

function shopeeRow(overrides: Partial<ShopeeRow> = {}): ShopeeRow {
  return {
    completedDate: "2026-07-03",
    affiliateName: "Affiliate A",
    affiliateUsername: "CRT-001", // resolved id, per aggregate.ts convention
    productId: "P1",
    productName: "Produk A",
    shopId: "S1",
    shopName: "Toko A",
    level1Category: "Cat1",
    level2Category: "Cat2",
    gmv: 100_000,
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

import { describe, expect, it } from "vitest";
import type { McnRow, TapRow } from "@/lib/ingest/schema";
import { computeLeak, normalizeShopId, type MasterShopEntry } from "../leak-compute";

/**
 * Tests for the in-platform leak engine that replaced the external "Agency Leaked
 * Generator" artifact. Focus: the two leak bases (per product = official per
 * CLAUDE.md #5, per shop = artifact comparison), partnered-shop resolution
 * (master ∪ TAP GMV, expired deals), TAP creator attribution + proportional
 * allocation for TAP rows without a creator column, and BD aggregation.
 */

const THRESHOLDS = { sebagian: 0.1, total: 0.5 };
const WEEK = "2026-07-01";

function mcn(over: Partial<McnRow>): McnRow {
  return {
    date: "2026-07-01-2026-07-07",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-07",
    creatorName: "creatorA",
    followerCount: null,
    productId: "P1",
    productInfo: "Produk 1",
    shopId: "111",
    shopName: "Shop Satu",
    level1Category: "Beauty",
    level2Category: "Skincare",
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
    ...over,
  };
}

function tap(over: Partial<TapRow>): TapRow {
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-07",
    creatorName: "creatorA",
    productId: "P1",
    productInfo: "Produk 1",
    shopId: "111",
    shopName: "Shop Satu",
    level2Category: "Skincare",
    affiliateGmv: 0,
    affiliateLiveGmv: 0,
    affiliateVideoGmv: 0,
    orders: 0,
    itemsSold: 0,
    estPartnerCommission: null,
    actualPartnerCommission: null,
    estCreatorCommission: null,
    actualCreatorCommission: null,
    refundGmv: 0,
    ...over,
  };
}

function master(...entries: Array<Partial<MasterShopEntry> & { shopId: string }>): Map<string, MasterShopEntry> {
  const m = new Map<string, MasterShopEntry>();
  for (const e of entries) {
    const key = normalizeShopId(e.shopId);
    m.set(key, { shopName: null, dealId: null, dealEnd: null, ...e, shopId: key });
  }
  return m;
}

describe("normalizeShopId", () => {
  it("compares shop ids by digits so stray formatting still joins", () => {
    expect(normalizeShopId("'1739400000000000123 ")).toBe("1739400000000000123");
    expect(normalizeShopId("1739400000000000123")).toBe(normalizeShopId("1739400000000000123"));
  });
  it("falls back to the lowercased raw value for non-numeric ids", () => {
    expect(normalizeShopId(" ShopABC ")).toBe("shopabc");
  });
});

describe("computeLeak — leak basis", () => {
  it("per-product basis does not let a TAP surplus on one product mask a leak on another", () => {
    const mcnRows = [
      mcn({ productId: "P1", affiliateGmv: 1_000_000 }),
      mcn({ productId: "P2", affiliateGmv: 1_000_000 }),
    ];
    // TAP over-reports P1 (1.5jt) and under-reports P2 (0.5jt): shop totals match (2jt),
    // so the artifact's per-shop formula would report ZERO leak.
    const tapRows = [
      tap({ productId: "P1", affiliateGmv: 1_500_000 }),
      tap({ productId: "P2", affiliateGmv: 500_000 }),
    ];
    const res = computeLeak({
      mcnRows, tapRows, master: master({ shopId: "111" }), week: WEEK, thresholds: THRESHOLDS,
    });
    const c = res.creators[0];
    expect(c.gmvBocor).toBe(500_000); // P2 leak survives
    expect(c.gmvBocorShopBasis).toBe(0); // artifact comparison figure
    expect(c.gmvDealTotal).toBe(2_000_000);
    expect(c.leakRatio).toBeCloseTo(0.25, 5);
    expect(c.linkStatus).toBe("bocor_sebagian");
    expect(res.detail).toHaveLength(1);
    expect(res.detail[0].productId).toBe("P2");
    expect(res.detail[0].linkStatus).toBe("bocor_sebagian");
  });

  it("classifies a fully captured creator as via_agency with no detail rows", () => {
    const res = computeLeak({
      mcnRows: [mcn({ affiliateGmv: 2_000_000, directGmv: 400_000 })],
      tapRows: [tap({ affiliateGmv: 2_000_000 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    const c = res.creators[0];
    expect(c.linkStatus).toBe("via_agency");
    expect(c.gmvBocor).toBe(0);
    expect(c.directGmv).toBe(400_000);
    expect(c.effectiveness).toBe(1);
    expect(res.detail).toHaveLength(0);
  });

  it("classifies zero TAP on a partnered shop as bocor_total", () => {
    const res = computeLeak({
      mcnRows: [mcn({ affiliateGmv: 3_000_000 })],
      // TAP exists for another shop entirely (so the file isn't empty).
      tapRows: [tap({ shopId: "999", productId: "P9", affiliateGmv: 10_000 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    const c = res.creators[0];
    expect(c.gmvBocor).toBe(3_000_000);
    expect(c.linkStatus).toBe("bocor_total");
    expect(c.leakRatio).toBe(1);
  });
});

describe("computeLeak — partnered shop resolution", () => {
  it("treats a shop absent from the master but with TAP GMV as ber-deal", () => {
    const res = computeLeak({
      mcnRows: [mcn({ affiliateGmv: 1_000_000 })],
      tapRows: [tap({ affiliateGmv: 400_000 })],
      master: new Map(), // master kosong
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    const c = res.creators[0];
    expect(c.gmvDealTotal).toBe(1_000_000);
    expect(c.bdOpportunityGmv).toBe(0);
    expect(c.gmvBocor).toBe(600_000);
    expect(res.bdShops).toHaveLength(0);
  });

  it("routes a shop with an expired deal to BD opportunity + expired alert basis", () => {
    const res = computeLeak({
      mcnRows: [mcn({ shopId: "222", affiliateGmv: 5_000_000, shopName: "Shop Expired" })],
      tapRows: [tap({ shopId: "111", affiliateGmv: 100_000 })],
      master: master({ shopId: "222", dealEnd: "2026-06-01", dealId: "DEAL-1", shopName: "Shop Expired" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    const c = res.creators[0];
    expect(c.bdOpportunityGmv).toBe(5_000_000);
    expect(c.gmvDealTotal).toBe(0);
    expect(c.linkStatus).toBe("belum_ada_link");
    expect(res.bdShops).toHaveLength(1);
    expect(res.bdShops[0].dealState).toBe("expired");
    expect(res.expiredShops).toEqual([
      { shopId: "222", shopName: "Shop Expired", dealId: "DEAL-1", dealEnd: "2026-06-01", gmv: 5_000_000 },
    ]);
  });

  it("keeps a shop ber-deal when deal_end is still in the future", () => {
    const res = computeLeak({
      mcnRows: [mcn({ affiliateGmv: 1_000_000 })],
      tapRows: [tap({ affiliateGmv: 1_000_000 })],
      master: master({ shopId: "111", dealEnd: "2026-12-31" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    expect(res.creators[0].gmvDealTotal).toBe(1_000_000);
    expect(res.expiredShops).toHaveLength(0);
    expect(res.partneredShopIds).toEqual(["111"]);
  });
});

describe("computeLeak — TAP attribution", () => {
  it("attributes TAP per creator (a second creator's TAP never covers the first's leak)", () => {
    const res = computeLeak({
      mcnRows: [
        mcn({ creatorName: "creatorA", affiliateGmv: 1_000_000 }),
        mcn({ creatorName: "creatorB", affiliateGmv: 1_000_000 }),
      ],
      tapRows: [tap({ creatorName: "creatorB", affiliateGmv: 2_000_000 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    const byName = new Map(res.creators.map((c) => [c.creatorName, c]));
    expect(byName.get("creatorA")!.gmvBocor).toBe(1_000_000);
    expect(byName.get("creatorA")!.linkStatus).toBe("bocor_total");
    expect(byName.get("creatorB")!.gmvBocor).toBe(0);
    expect(byName.get("creatorB")!.gmvTap).toBe(2_000_000);
  });

  it("allocates TAP rows WITHOUT a creator column proportionally to MCN share", () => {
    const res = computeLeak({
      mcnRows: [
        mcn({ creatorName: "creatorA", affiliateGmv: 750_000 }),
        mcn({ creatorName: "creatorB", affiliateGmv: 250_000 }),
      ],
      tapRows: [tap({ creatorName: "", affiliateGmv: 400_000 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    const byName = new Map(res.creators.map((c) => [c.creatorName, c]));
    // 75% / 25% split of the 400k agency GMV
    expect(byName.get("creatorA")!.gmvBocor).toBe(750_000 - 300_000);
    expect(byName.get("creatorB")!.gmvBocor).toBe(250_000 - 100_000);
    expect(res.warnings.join(" ")).toContain("baris TAP tanpa nama kreator");
  });

  it("matches creator names case-insensitively across MCN and TAP", () => {
    const res = computeLeak({
      mcnRows: [mcn({ creatorName: "CreatorA", affiliateGmv: 1_000_000 })],
      tapRows: [tap({ creatorName: "creatora", affiliateGmv: 1_000_000 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    expect(res.creators[0].gmvBocor).toBe(0);
    expect(res.creators[0].creatorName).toBe("CreatorA"); // printed as in the MCN file
    expect(res.tapOnlyCreators).toHaveLength(0);
  });

  it("flags TAP creators missing from the MCN file", () => {
    const res = computeLeak({
      mcnRows: [mcn({ creatorName: "creatorA", affiliateGmv: 1_000_000 })],
      tapRows: [
        tap({ creatorName: "creatorA", affiliateGmv: 1_000_000 }),
        tap({ creatorName: "typo_creator", affiliateGmv: 500_000 }),
      ],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    expect(res.tapOnlyCreators).toEqual(["typo_creator"]);
    expect(res.warnings.join(" ")).toContain("typo_creator");
  });
});

describe("computeLeak — BD opportunity + totals", () => {
  it("aggregates non-deal shops per shop with creator/product counts and priority", () => {
    const res = computeLeak({
      mcnRows: [
        mcn({ creatorName: "creatorA", shopId: "333", productId: "P1", affiliateGmv: 2_000_000, shopName: "Shop Baru", level1Category: "Home", level2Category: "Kitchen" }),
        mcn({ creatorName: "creatorB", shopId: "333", productId: "P2", affiliateGmv: 1_000_000, shopName: "Shop Baru", level1Category: "Home", level2Category: "Kitchen" }),
        mcn({ creatorName: "creatorA", shopId: "111", productId: "P3", affiliateGmv: 1_000_000 }),
      ],
      tapRows: [tap({ creatorName: "creatorA", productId: "P3", affiliateGmv: 1_000_000 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    expect(res.bdShops).toHaveLength(1);
    const shop = res.bdShops[0];
    expect(shop.shopId).toBe("333");
    expect(shop.gmv).toBe(3_000_000);
    expect(shop.creators).toEqual(["creatorA", "creatorB"]); // biggest GMV first
    expect(shop.products).toBe(2);
    expect(shop.level1Category).toBe("Home");
    expect(shop.priorityScore).toBe(2 * 3_000_000);
    expect(res.totals.gmvBdOpportunity).toBe(3_000_000);
    expect(res.totals.gmvAffiliateTotal).toBe(4_000_000);
    expect(res.totals.gmvTap).toBe(1_000_000);
    expect(res.totals.gmvBocor).toBe(0);
  });

  it("ignores non-deal shops with zero GMV (no empty leads)", () => {
    const res = computeLeak({
      mcnRows: [
        mcn({ shopId: "444", affiliateGmv: 0 }),
        mcn({ shopId: "111", affiliateGmv: 500_000 }),
      ],
      tapRows: [tap({ affiliateGmv: 500_000 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    expect(res.bdShops).toHaveLength(0);
  });

  it("sorts creators by leak desc and skips rows without a creator name", () => {
    const res = computeLeak({
      mcnRows: [
        mcn({ creatorName: "small", affiliateGmv: 1_000_000 }),
        mcn({ creatorName: "big", affiliateGmv: 9_000_000 }),
        mcn({ creatorName: "", affiliateGmv: 5_000_000 }),
      ],
      tapRows: [tap({ creatorName: "other", shopId: "111", productId: "PX", affiliateGmv: 1 })],
      master: master({ shopId: "111" }),
      week: WEEK,
      thresholds: THRESHOLDS,
    });
    expect(res.creators.map((c) => c.creatorName)).toEqual(["big", "small"]);
    expect(res.warnings.join(" ")).toContain("baris MCN tanpa nama kreator");
  });
});

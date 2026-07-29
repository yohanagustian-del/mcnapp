import { describe, expect, it } from "vitest";
import { buildBdCsv, buildDetailCsv, buildSummaryCsv } from "../leak-export";
import type { BdOpportunityShop, CreatorLeakRollup, LeakDetailRow } from "../leak-compute";

/** CSV backup builders — the CM's replacement for the artifact's Excel output. */

const WEEK = "2026-07-01";

const creator: CreatorLeakRollup = {
  creatorName: "creator, satu",
  gmvAffiliateTotal: 10_000_000.4,
  gmvTap: 6_000_000,
  gmvDealTotal: 8_000_000,
  gmvBocor: 2_000_000,
  gmvBocorShopBasis: 1_500_000,
  leakRatio: 0.25,
  leakRatioShopBasis: 0.1875,
  linkStatus: "bocor_sebagian",
  bdOpportunityGmv: 2_000_000,
  directGmv: 500_000,
  effectiveness: 0.6,
  partneredShops: 2,
  nonPartneredShops: 3,
};

const detail: LeakDetailRow = {
  creatorName: "creator1",
  shopId: "1739400000000000123",
  shopName: 'Shop "Bagus"',
  productId: "P1",
  productName: "Serum\nWajah",
  level1Category: "Beauty",
  level2Category: "Skincare",
  gmvAll: 1_000_000,
  gmvTap: 400_000,
  gmvBocor: 600_000,
  linkStatus: "bocor_sebagian",
};

const bdShop: BdOpportunityShop = {
  shopId: "333",
  shopName: "Shop Baru",
  level1Category: "Home",
  level2Category: null,
  gmv: 3_000_000,
  creators: ["creatorA", "creatorB"],
  products: 4,
  dealState: "expired",
  priorityScore: 6_000_000,
};

/** Splits a built CSV into its header + data lines, stripping the Excel BOM. */
function lines(csv: string): string[] {
  return csv.replace(/^﻿/, "").split("\r\n");
}

describe("buildSummaryCsv", () => {
  it("writes rounded rupiah, percent figures and quotes fields containing commas", () => {
    const rows = lines(buildSummaryCsv(WEEK, [creator]));
    expect(rows[0]).toBe(
      "week,creator,gmv_affiliate_total,gmv_tap,gmv_deal_total,gmv_bocor_produk," +
        "gmv_bocor_shop_basis,leak_ratio_persen,leak_ratio_shop_basis_persen,link_status," +
        "bd_opportunity_gmv,direct_gmv,efektivitas_link_persen,shop_ber_deal,shop_non_deal"
    );
    expect(rows[1]).toBe(
      '2026-07-01,"creator, satu",10000000,6000000,8000000,2000000,1500000,25.0,18.8,' +
        "bocor_sebagian,2000000,500000,60.0,2,3"
    );
  });

  it("renders unknown ratios as empty cells, never 0", () => {
    const rows = lines(
      buildSummaryCsv(WEEK, [
        // plain name (no comma) so the columns line up with a naive split
        { ...creator, creatorName: "creator1", leakRatio: null, leakRatioShopBasis: null, effectiveness: null },
      ])
    );
    const cells = rows[1].split(",");
    expect([cells[7], cells[8], cells[12]]).toEqual(["", "", ""]); // ratio, ratio_shop, efektivitas
  });

  it("keeps the BOM so Excel opens UTF-8 correctly", () => {
    expect(buildSummaryCsv(WEEK, [creator]).startsWith("﻿")).toBe(true);
  });
});

describe("buildDetailCsv", () => {
  it("escapes embedded quotes/newlines and keeps the 19-digit shop id as text", () => {
    const csv = buildDetailCsv(WEEK, [detail]);
    expect(csv).toContain('"Shop ""Bagus"""');
    expect(csv).toContain('"Serum\nWajah"');
    expect(csv).toContain("1739400000000000123");
    expect(lines(csv)).toHaveLength(2);
  });

  it("produces a header-only file when nothing leaked", () => {
    expect(lines(buildDetailCsv(WEEK, []))).toHaveLength(1);
  });
});

describe("buildBdCsv", () => {
  it("labels the deal state and joins the creator list", () => {
    const rows = lines(buildBdCsv(WEEK, [bdShop]));
    expect(rows[1]).toBe(
      "2026-07-01,333,Shop Baru,Home,,3000000,2,4,deal kadaluarsa,6000000,creatorA | creatorB"
    );
  });

  it("labels a never-partnered shop as belum ada deal", () => {
    const rows = lines(buildBdCsv(WEEK, [{ ...bdShop, dealState: "none" }]));
    expect(rows[1]).toContain("belum ada deal");
  });
});

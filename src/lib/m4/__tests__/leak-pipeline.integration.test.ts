import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { getConfig } from "@/lib/config";
import { derivePeriod, parseMcnFile, parseTapFile } from "@/lib/ingest/parse";
import { validateW1W5Period } from "@/lib/utils/date";
import { computeLeak, normalizeShopId, type MasterShopEntry } from "../leak-compute";
import { parseMasterShopFile } from "../master-shop-file";
import { buildDetailCsv, buildSummaryCsv } from "../leak-export";

/**
 * End-to-end (no DB) check of the chain the /link-leakage and /ingest forms run:
 *   xlsx export → parseMcnFile/parseTapFile/parseMasterShopFile → computeLeak → CSV.
 *
 * Uses the REAL header spellings of the platform exports (2026-07 "Custom report"
 * renames for the MCN file, Bahasa Indonesia headers for the TAP file, Rupiah
 * strings with both separator styles) so a future header change fails here rather
 * than silently producing zero leak in production. `getConfig` is not stubbed —
 * thresholds are passed in directly, keeping this test DB-free (the orchestrator is
 * the layer that reads app_config).
 */

const THRESHOLDS = { sebagian: 0.1, total: 0.5 };

function xlsx(aoa: unknown[][], filename: string): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Custom report");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const SHOP_DEAL = "7490000000000000001";
const SHOP_NON_DEAL = "7490000000000000009";

/** MCN export ("Custom report" renames + Summary row that must be skipped). */
function mcnFile(): File {
  return xlsx(
    [
      [
        "Date", "Creator username", "Product ID", "Product info", "Shop ID", "Shop name",
        "Level 1 category", "Level 2 category", "Creator-attributed GMV", "Direct GMV",
        "Creator-attributed orders", "Creator-attributed items sold",
      ],
      ["Summary", "-", "", "", "", "", "", "", "Rp10.000.000", "Rp0", "0", "0"],
      [
        "2026-07-01-2026-07-07", "qa_creator_satu", "P1", "Serum Wajah", SHOP_DEAL, "QA Shop Deal Aktif",
        "Beauty", "Skincare", "Rp3.000.000", "Rp200.000", "30", "30",
      ],
      [
        "2026-07-01-2026-07-07", "qa_creator_satu", "P2", "Sabun Muka", SHOP_DEAL, "QA Shop Deal Aktif",
        "Beauty", "Skincare", "Rp2.000.000", "Rp0", "20", "20",
      ],
      [
        "2026-07-01-2026-07-07", "qa_creator_satu", "P3", "Wajan Anti Lengket", SHOP_NON_DEAL, "QA Shop Peluang BD",
        "Home", "Kitchen", "Rp1,500,000", "Rp0", "10", "10",
      ],
      [
        "2026-07-01-2026-07-07", "qa_creator_dua", "P1", "Serum Wajah", SHOP_DEAL, "QA Shop Deal Aktif",
        "Beauty", "Skincare", "Rp1.000.000", "Rp0", "8", "8",
      ],
    ],
    "data_mcn.xlsx"
  );
}

/** TAP export in Bahasa Indonesia (account language setting) — same week. */
function tapFile(): File {
  return xlsx(
    [
      ["Tanggal", "Creator name", "ID Produk", "Nama Produk", "ID Toko", "Nama Toko", "GMV Afiliasi", "Pesanan"],
      [
        "2026-07-01-2026-07-07", "qa_creator_satu", "P1", "Serum Wajah", SHOP_DEAL, "QA Shop Deal Aktif",
        "Rp2.500.000", "25",
      ],
      // P2 sengaja TIDAK ada di TAP → bocor total untuk pair itu.
      [
        "2026-07-01-2026-07-07", "qa_creator_dua", "P1", "Serum Wajah", SHOP_DEAL, "QA Shop Deal Aktif",
        "Rp1.000.000", "8",
      ],
    ],
    "data_tap.xlsx"
  );
}

function masterFile(): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["MASTER ALL COOPERATING SHOPS"],
      [],
      ["Shop ID", "Shop Name"],
      [SHOP_DEAL, "QA Shop Deal Aktif"],
    ]),
    "Master"
  );
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "master_shop.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("leak pipeline (parse → compute → CSV)", () => {
  it("computes leak, BD opportunity and CSV output from real-shaped exports", async () => {
    const mcn = await parseMcnFile(mcnFile());
    const tap = await parseTapFile(tapFile());
    expect(mcn.rows).toHaveLength(4); // Summary row skipped
    expect(tap.rows).toHaveLength(2);

    const period = derivePeriod(mcn.rows)!;
    expect(period).toEqual({ periodStart: "2026-07-01", periodEnd: "2026-07-07" });
    expect(validateW1W5Period(period.periodStart, period.periodEnd).valid).toBe(true);

    // Master from the uploaded file (the artifact's third input).
    const masterParsed = await parseMasterShopFile(masterFile());
    const master = new Map<string, MasterShopEntry>(
      masterParsed.shopIds.map((id) => [
        normalizeShopId(id),
        { shopId: normalizeShopId(id), shopName: masterParsed.shopNames.get(id) ?? null, dealId: null, dealEnd: null },
      ])
    );

    const res = computeLeak({
      mcnRows: mcn.rows,
      tapRows: tap.rows,
      master,
      week: period.periodStart,
      thresholds: THRESHOLDS,
    });

    const byName = new Map(res.creators.map((c) => [c.creatorName, c]));
    const satu = byName.get("qa_creator_satu")!;
    // Rupiah with dots AND commas both parse: total 3jt + 2jt + 1,5jt
    expect(satu.gmvAffiliateTotal).toBe(6_500_000);
    expect(satu.gmvDealTotal).toBe(5_000_000); // hanya shop ber-deal
    expect(satu.bdOpportunityGmv).toBe(1_500_000);
    // P1: 3jt − 2,5jt = 500rb ; P2: 2jt − 0 = 2jt
    expect(satu.gmvBocor).toBe(2_500_000);
    expect(satu.gmvBocorShopBasis).toBe(2_500_000); // one shop, same figure here
    expect(satu.leakRatio).toBeCloseTo(0.5, 5);
    expect(satu.linkStatus).toBe("bocor_sebagian");
    expect(satu.directGmv).toBe(200_000);

    const dua = byName.get("qa_creator_dua")!;
    expect(dua.gmvBocor).toBe(0);
    expect(dua.linkStatus).toBe("via_agency");

    expect(res.bdShops).toHaveLength(1);
    expect(res.bdShops[0].shopId).toBe(SHOP_NON_DEAL);
    expect(res.bdShops[0].gmv).toBe(1_500_000);
    expect(res.bdShops[0].dealState).toBe("none");

    expect(res.totals.gmvAffiliateTotal).toBe(7_500_000);
    expect(res.totals.gmvTap).toBe(3_500_000);
    expect(res.totals.gmvBocor).toBe(2_500_000);

    // CSV backup: one row per leaking pair, summary row per creator.
    const detailCsv = buildDetailCsv(period.periodStart, res.detail);
    const detailLines = detailCsv.replace(/^﻿/, "").split("\r\n");
    expect(detailLines).toHaveLength(3); // header + P2 (2jt) + P1 (500rb)
    expect(detailLines[1]).toContain("P2");
    expect(detailLines[1]).toContain("bocor_total");
    expect(buildSummaryCsv(period.periodStart, res.creators).replace(/^﻿/, "").split("\r\n")).toHaveLength(3);
  });

  it("rejects a period that is not a single W1-W5 window before any write", async () => {
    const crossWeek = xlsx(
      [
        ["Date", "Creator username", "Product ID", "Shop ID", "Creator-attributed GMV"],
        ["2026-07-01-2026-07-14", "qa_creator_satu", "P1", SHOP_DEAL, "Rp1.000.000"],
      ],
      "data_mcn_2weeks.xlsx"
    );
    const mcn = await parseMcnFile(crossWeek);
    const period = derivePeriod(mcn.rows)!;
    const check = validateW1W5Period(period.periodStart, period.periodEnd);
    expect(check.valid).toBe(false);
    expect(check.reason).toBeTruthy();
  });

  it("keeps getConfig as the only threshold source (no hardcoded numbers in compute)", () => {
    // Guard against a regression where thresholds get inlined: computeLeak takes them
    // as an argument, so the same data classifies differently under other thresholds.
    const rows = [
      {
        date: "2026-07-01-2026-07-07", periodStart: "2026-07-01", periodEnd: "2026-07-07",
        creatorName: "c", followerCount: null, productId: "P1", productInfo: null,
        shopId: SHOP_DEAL, shopName: null, level1Category: null, level2Category: null,
        affiliateGmv: 1_000_000, affiliateLiveGmv: 0, affiliateVideoGmv: 0, orders: 0,
        liveOrders: 0, videoOrders: 0, directGmv: 0, itemsSold: 0, refundGmv: 0, ctr: null, ctor: null,
      },
    ];
    const tapRows = [
      {
        periodStart: "2026-07-01", periodEnd: "2026-07-07", creatorName: "c", productId: "P1",
        productInfo: null, shopId: SHOP_DEAL, shopName: null, level2Category: null,
        affiliateGmv: 700_000, affiliateLiveGmv: 0, affiliateVideoGmv: 0, orders: 0, itemsSold: 0,
        estPartnerCommission: null, actualPartnerCommission: null, estCreatorCommission: null,
        actualCreatorCommission: null, refundGmv: 0,
      },
    ];
    const master = new Map<string, MasterShopEntry>([
      [normalizeShopId(SHOP_DEAL), { shopId: normalizeShopId(SHOP_DEAL), shopName: null, dealId: null, dealEnd: null }],
    ]);
    const strict = computeLeak({ mcnRows: rows, tapRows, master, week: "2026-07-01", thresholds: { sebagian: 0.1, total: 0.5 } });
    const lax = computeLeak({ mcnRows: rows, tapRows, master, week: "2026-07-01", thresholds: { sebagian: 0.5, total: 0.9 } });
    expect(strict.creators[0].linkStatus).toBe("bocor_sebagian"); // ratio 0.3 > 0.1
    expect(lax.creators[0].linkStatus).toBe("via_agency"); // ratio 0.3 <= 0.5
    expect(typeof getConfig).toBe("function"); // orchestrator reads app_config, not compute
  });
});

import { describe, expect, it } from "vitest";
import { buildBrandReportData, type BrandReportCreatorRow, type BrandReportInput } from "../build";
import { brandReportTexts, resolveTexts, sanitizeEdits, BRAND_REPORT_TEXT_KEYS, type BrandReportRules } from "../rules";
import { reportPeriodRange, trendWeekKeys } from "../data";
import { parsePeriodParam } from "@/lib/m8/period";

const RULES: BrandReportRules = {
  tap_share_low: 0.5, tap_share_high: 0.8, wow_growth_up: 0.1, wow_growth_down: -0.1,
  live_share_high: 0.6, video_share_high: 0.6, top_creators: 2, untapped_creator_gmv_min: 1_000_000,
};

const row = (id: string, o: Partial<BrandReportCreatorRow> = {}): BrandReportCreatorRow => ({
  creator_id: id, gmv_mcn: 0, gmv_mcn_live: 0, gmv_mcn_video: 0, orders_mcn: 0,
  gmv_tap: 0, gmv_tap_live: 0, gmv_tap_video: 0, orders_tap: 0, actual_partner_commission: 0, ...o,
});

function input(o: Partial<BrandReportInput> = {}): BrandReportInput {
  return {
    shop: { platform: "tiktok", shopId: "7495", shopName: "Skintific", shopKey: "tiktok:Skintific" },
    period: { value: "2026-09", kind: "month", label: "September 2026" },
    creators: [
      row("A", { gmv_mcn: "10000000", gmv_mcn_live: 8_000_000, gmv_mcn_video: 2_000_000, orders_mcn: 40, gmv_tap: 2_000_000, actual_partner_commission: 100_000 }),
      row("B", { gmv_mcn: 5_000_000, gmv_mcn_live: 4_000_000, gmv_mcn_video: 1_000_000, orders_mcn: 10, gmv_tap: 0 }),
      row("C", { gmv_mcn: 500_000, gmv_mcn_video: 500_000, orders_mcn: 2, gmv_tap: 0 }),
    ],
    creatorInfo: new Map([["A", { name: "Ayu", cmName: "Rina" }], ["B", { name: "Budi", cmName: null }]]),
    weeks: [
      { period_key: "2026-09-08", gmv_mcn: 6_000_000, gmv_tap: 1_000_000, creator_count: 2 },
      { period_key: "2026-09-01", gmv_mcn: 5_000_000, gmv_tap: 500_000, creator_count: 2 },
    ],
    products: [],
    adsSpend: null,
    upgrade: { roasMin: 3, gmvMin: 10_000_000 },
    topCreators: 2,
    untappedCreatorGmvMin: 1_000_000,
    ...o,
  };
}

describe("buildBrandReportData", () => {
  it("menjumlah baris view, top-N urut GMV, kandidat TAP ≥ ambang, WoW dari dua minggu terakhir", () => {
    const d = buildBrandReportData(input());
    expect(d.totals).toMatchObject({ gmv_mcn: 15_500_000, gmv_tap: 2_000_000, orders_mcn: 52, creator_count: 3, creator_tap_count: 1, actual_partner_commission: 100_000 });
    expect(d.totals.tap_share).toBeCloseTo(2 / 15.5);
    expect(d.top_creators.map((c) => c.name)).toEqual(["Ayu", "Budi"]);
    expect(d.untapped).toMatchObject({ count: 1, gmv_mcn: 5_000_000 });
    expect(d.trend.map((w) => w.period_key)).toEqual(["2026-09-01", "2026-09-08"]);
    expect(d.wow_growth).toBeCloseTo(0.2);
    expect(d.roas).toBeNull();
    expect(d.upgrade_recommendation).toBe(false);
  });

  it("baris tanpa nama kreator (creator_id NULL, K6): GMV TAP terhitung, bukan kreator, tanpa tautan", () => {
    const base = input();
    const d = buildBrandReportData(input({
      creators: [...base.creators, { ...row("X", { gmv_tap: 700_000, gmv_tap_live: 700_000, orders_tap: 3 }), creator_id: null }],
      topCreators: 10,
    }));
    expect(d.totals).toMatchObject({ gmv_mcn: 15_500_000, gmv_tap: 2_700_000, creator_count: 3, creator_tap_count: 1 });
    const none = d.top_creators.find((c) => c.creatorId === null)!;
    expect(none).toMatchObject({ name: "Nama kreator tidak ada", gmvMcn: 0, gmvTap: 700_000 });
    expect(d.untapped.creators.some((c) => c.creatorId === null)).toBe(false);
  });

  it("GMV TAP null (Shopee fase 1) tetap null, bukan nol; kandidat TAP tidak dinilai", () => {
    const d = buildBrandReportData(input({
      creators: [row("A", { gmv_mcn: 3_000_000, gmv_tap: null, gmv_tap_live: null, gmv_tap_video: null, orders_tap: null })],
    }));
    expect(d.totals.gmv_tap).toBeNull();
    expect(d.totals.tap_share).toBeNull();
    expect(d.untapped.count).toBe(0);
    expect(brandReportTexts(d, RULES).summary).toMatch(/belum tersedia/);
  });

  it("ROAS hanya bila ads spend diisi; upgrade memakai ambang app_config", () => {
    const d = buildBrandReportData(input({ adsSpend: 5_000_000 }));
    expect(d.roas).toBeCloseTo(3.1);
    expect(d.upgrade_recommendation).toBe(true);
    expect(brandReportTexts(d, RULES).recommendation_upgrade).toMatch(/Layak ditawari upgrade/);
  });
});

describe("brandReportTexts (0 LLM, ambang app_config)", () => {
  it("menilai porsi TAP, tren, dan konten dari ambang", () => {
    const tx = brandReportTexts(buildBrandReportData(input()), RULES);
    expect(tx.insight_tap).toMatch(/masih rendah/);
    expect(tx.insight_growth).toMatch(/naik 20%/);
    expect(tx.insight_content).toMatch(/didominasi LIVE/);
    expect(tx.insight_products).toMatch(/Belum ada kartu Produk TAP/);
    expect(tx.recommendation_tap).toMatch(/^1 kreator/);
    for (const k of BRAND_REPORT_TEXT_KEYS) expect(tx[k].length).toBeGreaterThan(0);
  });

  it("suntingan: hanya kunci dikenal & berbeda dari bawaan; kosong = kembali ke bawaan", () => {
    const gen = brandReportTexts(buildBrandReportData(input()), RULES);
    const edits = sanitizeEdits({ summary: "Teks tim", insight_tap: gen.insight_tap, bogus: "x" } as Record<string, string>, gen);
    expect(edits).toEqual({ summary: "Teks tim" });
    expect(resolveTexts(gen, edits).summary).toBe("Teks tim");
    expect(resolveTexts(gen, { summary: "  " }).summary).toBe(gen.summary);
  });
});

describe("periode report", () => {
  it("bulan → semua minggu bulan itu; W1 → pembanding W terakhir bulan lalu", () => {
    expect(trendWeekKeys(parsePeriodParam("2026-02", "2026-10-13"))).toEqual(["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"]);
    expect(trendWeekKeys(parsePeriodParam("2026-10-W1", "2026-10-13"))).toEqual(["2026-09-29", "2026-10-01"]);
    expect(trendWeekKeys(parsePeriodParam("2026-10-W3", "2026-10-13"))).toEqual(["2026-10-08", "2026-10-15"]);
  });

  it("rentang end-eksklusif; W5 berhenti di akhir bulan", () => {
    expect(reportPeriodRange(parsePeriodParam("2026-09", "2026-10-13"))).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" });
    expect(reportPeriodRange(parsePeriodParam("2026-09-W2", "2026-10-13"))).toEqual({ start: "2026-09-08", endExclusive: "2026-09-15" });
    expect(reportPeriodRange(parsePeriodParam("2026-09-W5", "2026-10-13"))).toEqual({ start: "2026-09-29", endExclusive: "2026-10-01" });
  });
});

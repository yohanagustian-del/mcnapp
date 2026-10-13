import type { BrandReportData } from "./build";

/**
 * Report Brand v2 — SEMUA kalimat dari aturan + ambang `app_config m8.brand_report_rules`
 * (pola Report Kreator M2 v2: 0 LLM, token_used selalu 0). Tim boleh menyunting TEKS
 * lewat `brand_reports.edits_json` (per kunci di bawah); angka tidak pernah bisa disunting.
 */

export interface BrandReportRules {
  tap_share_low: number;
  tap_share_high: number;
  wow_growth_up: number;
  wow_growth_down: number;
  live_share_high: number;
  video_share_high: number;
  top_creators: number;
  untapped_creator_gmv_min: number;
}

export const BRAND_REPORT_TEXT_KEYS = [
  "summary",
  "insight_tap",
  "insight_growth",
  "insight_content",
  "insight_products",
  "recommendation_tap",
  "recommendation_upgrade",
] as const;
export type BrandReportTextKey = (typeof BRAND_REPORT_TEXT_KEYS)[number];

export const BRAND_REPORT_TEXT_LABEL: Record<BrandReportTextKey, string> = {
  summary: "Ringkasan",
  insight_tap: "Insight — porsi TAP",
  insight_growth: "Insight — tren minggu ke minggu",
  insight_content: "Insight — live vs video",
  insight_products: "Insight — Produk TAP",
  recommendation_tap: "Rekomendasi — kreator belum pakai TAP",
  recommendation_upgrade: "Rekomendasi — upgrade service",
};

export type BrandReportTexts = Record<BrandReportTextKey, string>;

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const pct = (x: number) => `${(x * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

export function brandReportTexts(d: BrandReportData, rules: BrandReportRules): BrandReportTexts {
  const t = d.totals;
  const shop = d.shop.shop_name;
  const platform = d.shop.platform === "shopee" ? "Shopee" : "TikTok Shop";

  const summary =
    t.creator_count === 0
      ? `Belum ada GMV kreator MCN di ${shop} (${platform}) untuk ${d.period.label}.`
      : `${shop} (${platform}) periode ${d.period.label}: GMV kreator MCN ${rp(t.gmv_mcn)} dari ${t.creator_count} kreator, ` +
        `${t.orders_mcn.toLocaleString("id-ID")} order.` +
        (t.gmv_tap === null
          ? " GMV lewat link agency (TAP) belum tersedia untuk data ini."
          : ` Lewat link agency (TAP) ${rp(t.gmv_tap)}${t.tap_share === null ? "" : ` (${pct(t.tap_share)} dari GMV MCN)`} oleh ${t.creator_tap_count} kreator.`);

  let insightTap: string;
  if (t.tap_share === null) insightTap = "Porsi GMV lewat TAP belum bisa dinilai (data TAP belum tersedia atau GMV MCN nol).";
  else if (t.tap_share < rules.tap_share_low)
    insightTap = `Porsi GMV lewat link agency masih rendah (${pct(t.tap_share)}, di bawah ${pct(rules.tap_share_low)}): sebagian besar penjualan kreator MCN di shop ini belum tercatat sebagai TAP.`;
  else if (t.tap_share >= rules.tap_share_high)
    insightTap = `Mayoritas GMV kreator MCN sudah lewat link agency (${pct(t.tap_share)}).`;
  else insightTap = `Porsi GMV lewat link agency ${pct(t.tap_share)} — masih ada ruang dinaikkan ke ${pct(rules.tap_share_high)}.`;

  let insightGrowth: string;
  if (d.wow_growth === null) insightGrowth = "Belum ada dua minggu data untuk membandingkan tren minggu ke minggu.";
  else if (d.wow_growth >= rules.wow_growth_up) insightGrowth = `GMV MCN minggu terakhir naik ${pct(d.wow_growth)} dibanding minggu sebelumnya.`;
  else if (d.wow_growth <= rules.wow_growth_down) insightGrowth = `GMV MCN minggu terakhir turun ${pct(Math.abs(d.wow_growth))} dibanding minggu sebelumnya.`;
  else insightGrowth = `GMV MCN minggu terakhir relatif stabil (${d.wow_growth >= 0 ? "+" : "−"}${pct(Math.abs(d.wow_growth))}).`;

  let insightContent: string;
  if (t.live_share === null || t.video_share === null) insightContent = "Komposisi live vs video belum bisa dinilai (GMV MCN nol).";
  else if (t.live_share >= rules.live_share_high) insightContent = `Penjualan didominasi LIVE (${pct(t.live_share)} GMV MCN).`;
  else if (t.video_share >= rules.video_share_high) insightContent = `Penjualan didominasi VIDEO (${pct(t.video_share)} GMV MCN).`;
  else insightContent = `Penjualan campuran: live ${pct(t.live_share)}, video ${pct(t.video_share)} dari GMV MCN.`;

  const insightProducts =
    d.tap_products.length === 0
      ? "Belum ada kartu Produk TAP aktif untuk shop ini — daftarkan lewat Registrasi Deal supaya kreator bisa diarahkan ke link agency."
      : `${d.tap_products.length} kartu Produk TAP aktif untuk shop ini.`;

  const recommendationTap =
    t.gmv_tap === null
      ? "Kandidat kreator TAP belum bisa dihitung karena data TAP belum tersedia."
      : d.untapped.count === 0
        ? `Tidak ada kreator ber-GMV ≥ ${rp(rules.untapped_creator_gmv_min)} yang berjualan di shop ini tanpa link agency.`
        : `${d.untapped.count} kreator ber-GMV ≥ ${rp(rules.untapped_creator_gmv_min)} berjualan di shop ini tanpa link agency ` +
          `(total ${rp(d.untapped.gmv_mcn)}) — ajak memakai link TAP (lihat TAP Matchmaking).`;

  const th = d.upgrade_thresholds;
  const recommendationUpgrade =
    d.roas === null
      ? "ROAS tidak dihitung karena ads spend brand tidak diisi — saran upgrade service belum bisa dinilai."
      : d.upgrade_recommendation
        ? `Layak ditawari upgrade service: ROAS ${d.roas.toFixed(2)} ≥ ${th.roas_min} dan GMV ${rp(t.gmv_mcn)} ≥ ${rp(th.gmv_min)}.`
        : `Belum memenuhi ambang upgrade service (ROAS ${d.roas.toFixed(2)} vs ${th.roas_min}; GMV ${rp(t.gmv_mcn)} vs ${rp(th.gmv_min)}).`;

  return {
    summary,
    insight_tap: insightTap,
    insight_growth: insightGrowth,
    insight_content: insightContent,
    insight_products: insightProducts,
    recommendation_tap: recommendationTap,
    recommendation_upgrade: recommendationUpgrade,
  };
}

/** Teks tampil = suntingan tim (bila ada & tidak kosong) atau kalimat aturan. */
export function resolveTexts(generated: Partial<BrandReportTexts>, edits: unknown): BrandReportTexts {
  const e = (edits && typeof edits === "object" ? edits : {}) as Record<string, unknown>;
  const out = {} as BrandReportTexts;
  for (const k of BRAND_REPORT_TEXT_KEYS) {
    const v = typeof e[k] === "string" ? (e[k] as string).trim() : "";
    out[k] = v || generated[k] || "";
  }
  return out;
}

/** Suntingan dari form → hanya kunci dikenal, teks yang BERBEDA dari kalimat aturan, maks 2000 karakter. */
export function sanitizeEdits(input: Record<string, string>, generated: Partial<BrandReportTexts>): Partial<BrandReportTexts> {
  const out: Partial<BrandReportTexts> = {};
  for (const k of BRAND_REPORT_TEXT_KEYS) {
    const v = (input[k] ?? "").trim().slice(0, 2000);
    if (v && v !== (generated[k] ?? "").trim()) out[k] = v;
  }
  return out;
}

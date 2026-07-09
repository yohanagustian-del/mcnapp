/**
 * Module 0.5 — header maps for the two shared platform report shapes (MCN report /
 * CSV-1-all, TAP report / CSV-2-agency-link) → internal field names.
 *
 * Headers arrive normalized by parseSheet/parseCsv (trim → lowercase → spaces→"_"),
 * so "Estimated affiliate partner commission " (TAP, trailing space) normalizes to
 * "estimated_affiliate_partner_commission" identically to a header without the
 * trailing space — the maps below use the normalized form. Confirmed against the
 * production sample files (CLAUDE.md task spec §4); do not re-guess column names.
 *
 * Baris pertama data platform ("Date" == "Summary") harus di-skip via isSummaryRow
 * (src/lib/utils/csv.ts) sebelum memakai map ini. Nilai Rupiah via parseRupiah
 * (src/lib/utils/rupiah.ts); persentase ("5.45%") diparse ke number oleh parsePercent
 * di file ini.
 */

/** MCN report (CSV-1 / all) — normalized header → internal field. */
export const MCN_COLUMNS = {
  date: "date",
  creator: "creator_username",
  productId: "product_id",
  productInfo: "product_info",
  shopId: "shop_id",
  shopName: "shop_name",
  cat1: "level_1_category",
  cat2: "level_2_category",
  gmv: "affiliate_gmv",
  gmvLive: "affiliate_live_gmv",
  gmvVideo: "affiliate_video_gmv",
  orders: "affiliate_orders",
  liveOrders: "affiliate_live_orders",
  videoOrders: "affiliate_video_orders",
  directGmv: "direct_gmv",
  itemsSold: "items_sold",
  refundGmv: "direct_refund_gmv",
  ctr: "ctr",
  ctor: "ctor",
} as const;

/** TAP report (CSV-2 / agency-link) — normalized header → internal field. */
export const TAP_COLUMNS = {
  date: "date",
  creator: "creator_name",
  productId: "product_id",
  productInfo: "product_name",
  shopId: "shop_id",
  shopName: "shop_name",
  cat1: "level_1_category",
  cat2: "level_2_category",
  gmv: "affiliate_gmv",
  gmvVideo: "affiliate_video_gmv",
  gmvLive: "affiliate_live_gmv",
  orders: "orders",
  itemsSold: "items_sold",
  estPartnerCommission: "estimated_affiliate_partner_commission",
  actualPartnerCommission: "actual_affiliate_partner_commission",
  estCreatorCommission: "estimated_creator_commission",
  actualCreatorCommission: "actual_creator_commission",
  refundGmv: "gmv_(refund)",
} as const;

/** Internal row shape produced by parse.ts for the MCN (all) report. One row = one (date, product, shop). */
export interface McnRow {
  date: string; // raw period range string ("2026-06-28-2026-07-04"), parsed later by parsePeriodRange
  periodStart: string | null;
  periodEnd: string | null;
  creatorName: string;
  productId: string;
  productInfo: string | null;
  shopId: string;
  shopName: string | null;
  level1Category: string | null;
  level2Category: string | null;
  affiliateGmv: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
  orders: number;
  liveOrders: number;
  videoOrders: number;
  directGmv: number;
  itemsSold: number;
  refundGmv: number;
  ctr: number | null;
  ctor: number | null;
}

/** Internal row shape produced by parse.ts for the TAP (agency-link) report. */
export interface TapRow {
  periodStart: string | null;
  periodEnd: string | null;
  creatorName: string;
  productId: string;
  productInfo: string | null;
  shopId: string;
  shopName: string | null;
  level2Category: string | null;
  affiliateGmv: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
  orders: number;
  itemsSold: number;
  estPartnerCommission: number | null;
  actualPartnerCommission: number | null;
  estCreatorCommission: number | null;
  actualCreatorCommission: number | null;
  refundGmv: number;
}

/**
 * ID→EN header aliases (Module 0.5 QA bug). TikTok Shop platform exports can be in
 * Bahasa Indonesia depending on account language setting — the sheet still has the
 * same columns/order, only the header text differs. Keys are NORMALIZED Indonesian
 * headers (already trim→lowercase→spaces→"_", same normalization as parseCsv/parseSheet),
 * values are the normalized ENGLISH header used by MCN_COLUMNS/TAP_COLUMNS above.
 * Applied in parse.ts via translateRowKeys AFTER parseSheet, BEFORE reading MCN_COLUMNS/
 * TAP_COLUMNS fields — an EN key already present on the row is never overwritten (so
 * a file that happens to mix both, or the pure-English path, is unaffected).
 *
 * Only maps headers this module actually reads (MCN_COLUMNS / TAP_COLUMNS values).
 * Other Indonesian columns present in the real export (tanggal_perbandingan,
 * pesanan_langsung, gmv_langsung_dari_live, dll) are intentionally NOT mapped —
 * they're not read by this module either in English or Indonesian.
 */
export const MCN_HEADER_ALIASES: Record<string, string> = {
  tanggal: "date",
  nama_pengguna_kreator: "creator_username",
  id_produk: "product_id",
  info_produk: "product_info",
  id_toko: "shop_id",
  nama_toko: "shop_name",
  kategori_level_1: "level_1_category",
  kategori_level_2: "level_2_category",
  gmv_afiliasi: "affiliate_gmv",
  gmv_live_afiliasi: "affiliate_live_gmv",
  gmv_video_afiliasi: "affiliate_video_gmv",
  pesanan_dari_afiliasi: "affiliate_orders",
  pesanan_dari_live_afiliasi: "affiliate_live_orders",
  pesanan_dari_video_afiliasi: "affiliate_video_orders",
  gmv_langsung: "direct_gmv",
  produk_terjual: "items_sold",
  gmv_pengembalian_dana_langsung: "direct_refund_gmv",
  ctr: "ctr",
  ctor: "ctor",
};

/** TAP (CSV-2 / agency-link) ID→EN header aliases. See MCN_HEADER_ALIASES doc above. */
export const TAP_HEADER_ALIASES: Record<string, string> = {
  tanggal: "date",
  nama_produk: "product_name",
  id_produk: "product_id",
  id_toko: "shop_id",
  nama_toko: "shop_name",
  kategori_level_1: "level_1_category",
  kategori_level_2: "level_2_category",
  gmv_afiliasi: "affiliate_gmv",
  gmv_video_afiliasi: "affiliate_video_gmv",
  gmv_live_afiliasi: "affiliate_live_gmv",
  pesanan: "orders",
  produk_terjual: "items_sold",
  perkiraan_komisi_affiliate_partner: "estimated_affiliate_partner_commission",
  komisi_aktual_untuk_affiliate_partner: "actual_affiliate_partner_commission",
  perkiraan_komisi_kreator: "estimated_creator_commission",
  komisi_aktual_untuk_kreator: "actual_creator_commission",
  "gmv_(pengembalian_dana)": "gmv_(refund)",
};

/** Percentage cell ("5.45%" / "13.19%") → number (5.45). null when unreadable (never crash). */
export function parsePercent(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (s === "" || s === "-" || s === "--") return null;
  const n = Number(s.replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

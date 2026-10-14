import { shouldRecommendUpgrade } from "@/lib/m8/routing";
import { NO_CREATOR_LABEL } from "@/lib/m8/shop-perf-data";

/**
 * Report Brand v2 (REVISI_BIZDEV T9) — angka. Murni, 0 LLM.
 *
 * Sumber: baris view migrasi 0087 yang SUDAH diagregasi SQL dari creator_shop_period_gmv
 * (creator_shop_perf per kreator, shop_period_summary per minggu untuk tren) + kartu
 * Produk TAP shop itu. Fungsi ini hanya menjumlah/mengurutkan baris yang sudah jadi —
 * tidak ada perhitungan GMV kedua (CLAUDE.md #4).
 *
 * GMV TAP null (Shopee fase 1 / upload tanpa file TAP) dibawa sebagai null, BUKAN nol:
 * report harus bilang datanya belum ada.
 */

export const BRAND_REPORT_SCHEMA_VERSION = 2;

export interface BrandReportCreatorRow {
  /** NULL = GMV TAP tanpa nama kreator (migrasi 0088, K6). */
  creator_id: string | null;
  gmv_mcn: number | string | null;
  gmv_mcn_live: number | string | null;
  gmv_mcn_video: number | string | null;
  orders_mcn: number | string | null;
  gmv_tap: number | string | null;
  gmv_tap_live: number | string | null;
  gmv_tap_video: number | string | null;
  orders_tap: number | string | null;
  actual_partner_commission: number | string | null;
}

export interface BrandReportWeekRow {
  period_key: string;
  gmv_mcn: number | string | null;
  gmv_tap: number | string | null;
  creator_count: number | string | null;
}

export interface BrandReportProductRow {
  campaign_id: string;
  product_id: string;
  product_name: string | null;
  price: number | string | null;
  commission_pct: number | string | null;
  partner_commission_pct: number | string | null;
  effective_end: string | null;
  affiliate_gmv: number | string | null;
}

export interface BrandReportInput {
  shop: { platform: string; shopId: string; shopName: string; shopKey: string | null };
  period: { value: string; kind: "week" | "month"; label: string };
  creators: BrandReportCreatorRow[];
  creatorInfo: Map<string, { name: string; cmName: string | null }>;
  /** Minggu-minggu shop ini s/d akhir periode (urutan bebas). */
  weeks: BrandReportWeekRow[];
  /** Kartu Produk TAP shop ini yang masih aktif. */
  products: BrandReportProductRow[];
  adsSpend: number | null;
  upgrade: { roasMin: number; gmvMin: number };
  topCreators: number;
  untappedCreatorGmvMin: number;
}

export interface BrandReportCreator {
  /** null = baris "Nama kreator tidak ada" (GMV TAP tetap terhitung, bukan kreator). */
  creatorId: string | null;
  name: string;
  cmName: string | null;
  gmvMcn: number;
  gmvTap: number | null;
  gmvLive: number;
  gmvVideo: number;
  orders: number;
}

export interface BrandReportData {
  schema_version: 2;
  shop: { platform: string; shop_id: string; shop_name: string; shop_key: string | null };
  period: { value: string; kind: "week" | "month"; label: string };
  totals: {
    gmv_mcn: number;
    gmv_tap: number | null;
    tap_share: number | null;
    gmv_mcn_live: number;
    gmv_mcn_video: number;
    live_share: number | null;
    video_share: number | null;
    gmv_tap_live: number | null;
    gmv_tap_video: number | null;
    orders_mcn: number;
    orders_tap: number | null;
    creator_count: number;
    creator_tap_count: number;
    actual_partner_commission: number;
  };
  top_creators: BrandReportCreator[];
  /** Kreator ber-GMV ≥ ambang di shop ini yang belum lewat link agency (GMV TAP = 0). */
  untapped: { count: number; gmv_mcn: number; creators: BrandReportCreator[] };
  trend: { period_key: string; gmv_mcn: number; gmv_tap: number | null; creator_count: number }[];
  /** Pertumbuhan GMV MCN minggu terakhir vs minggu sebelumnya; null = belum ada pembanding. */
  wow_growth: number | null;
  tap_products: {
    campaign_id: string; product_id: string; product_name: string | null; price: number | null;
    commission_pct: number | null; partner_commission_pct: number | null; effective_end: string | null;
    gmv_tap: number | null;
  }[];
  ads_spend: number | null;
  roas: number | null;
  upgrade_recommendation: boolean;
  upgrade_thresholds: { roas_min: number; gmv_min: number };
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const share = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
/** Σ yang tetap null bila SEMUA nilai null (sama dengan sum() SQL). */
const sumNullable = (vals: (number | null)[]): number | null =>
  vals.every((v) => v === null) ? null : vals.reduce<number>((s, v) => s + (v ?? 0), 0);

export function buildBrandReportData(input: BrandReportInput): BrandReportData {
  const creators: BrandReportCreator[] = input.creators.map((r) => {
    const info = r.creator_id ? input.creatorInfo.get(r.creator_id) : undefined;
    return {
      creatorId: r.creator_id,
      name: r.creator_id ? info?.name ?? r.creator_id : NO_CREATOR_LABEL,
      cmName: info?.cmName ?? null,
      gmvMcn: num(r.gmv_mcn),
      gmvTap: numOrNull(r.gmv_tap),
      gmvLive: num(r.gmv_mcn_live),
      gmvVideo: num(r.gmv_mcn_video),
      orders: num(r.orders_mcn),
    };
  });
  const byGmv = [...creators].sort((a, b) => b.gmvMcn - a.gmvMcn || a.name.localeCompare(b.name, "id"));

  const gmvMcn = creators.reduce((s, c) => s + c.gmvMcn, 0);
  const gmvTap = sumNullable(creators.map((c) => c.gmvTap));
  const live = creators.reduce((s, c) => s + c.gmvLive, 0);
  const video = creators.reduce((s, c) => s + c.gmvVideo, 0);
  const tapLive = sumNullable(input.creators.map((r) => numOrNull(r.gmv_tap_live)));
  const tapVideo = sumNullable(input.creators.map((r) => numOrNull(r.gmv_tap_video)));
  const ordersTap = sumNullable(input.creators.map((r) => numOrNull(r.orders_tap)));

  // Kandidat TAP hanya bisa dinilai bila data TAP ada (gmvTap null = tidak diketahui).
  const untapped = byGmv.filter((c) => c.gmvTap !== null && c.gmvTap <= 0 && c.gmvMcn >= input.untappedCreatorGmvMin);

  const trend = [...input.weeks]
    .map((w) => ({
      period_key: w.period_key,
      gmv_mcn: num(w.gmv_mcn),
      gmv_tap: numOrNull(w.gmv_tap),
      creator_count: num(w.creator_count),
    }))
    .sort((a, b) => a.period_key.localeCompare(b.period_key));
  const [prev, last] = trend.slice(-2);
  const wow = trend.length >= 2 && prev.gmv_mcn > 0 ? (last.gmv_mcn - prev.gmv_mcn) / prev.gmv_mcn : null;

  const roas = input.adsSpend !== null && input.adsSpend > 0 ? gmvMcn / input.adsSpend : null;
  // Satu aturan upgrade (LOCKED §6.5), ambang app_config apa adanya.
  const upgrade = shouldRecommendUpgrade(gmvMcn, roas, input.upgrade);

  return {
    schema_version: BRAND_REPORT_SCHEMA_VERSION,
    shop: {
      platform: input.shop.platform,
      shop_id: input.shop.shopId,
      shop_name: input.shop.shopName,
      shop_key: input.shop.shopKey,
    },
    period: input.period,
    totals: {
      gmv_mcn: gmvMcn,
      gmv_tap: gmvTap,
      tap_share: gmvTap === null ? null : share(gmvTap, gmvMcn),
      gmv_mcn_live: live,
      gmv_mcn_video: video,
      live_share: share(live, gmvMcn),
      video_share: share(video, gmvMcn),
      gmv_tap_live: tapLive,
      gmv_tap_video: tapVideo,
      orders_mcn: creators.reduce((s, c) => s + c.orders, 0),
      orders_tap: ordersTap,
      creator_count: creators.filter((c) => c.creatorId !== null && (c.gmvMcn > 0 || (c.gmvTap ?? 0) > 0)).length,
      creator_tap_count: creators.filter((c) => c.creatorId !== null && (c.gmvTap ?? 0) > 0).length,
      actual_partner_commission: input.creators.reduce((s, r) => s + num(r.actual_partner_commission), 0),
    },
    top_creators: byGmv.slice(0, Math.max(0, input.topCreators)),
    untapped: {
      count: untapped.length,
      gmv_mcn: untapped.reduce((s, c) => s + c.gmvMcn, 0),
      creators: untapped.slice(0, Math.max(0, input.topCreators)),
    },
    trend,
    wow_growth: wow,
    tap_products: [...input.products]
      .map((p) => ({
        campaign_id: p.campaign_id,
        product_id: p.product_id,
        product_name: p.product_name,
        price: numOrNull(p.price),
        commission_pct: numOrNull(p.commission_pct),
        partner_commission_pct: numOrNull(p.partner_commission_pct),
        effective_end: p.effective_end,
        gmv_tap: numOrNull(p.affiliate_gmv),
      }))
      .sort((a, b) => (b.gmv_tap ?? -1) - (a.gmv_tap ?? -1) || (a.product_name ?? "").localeCompare(b.product_name ?? "", "id")),
    ads_spend: input.adsSpend,
    roas,
    upgrade_recommendation: upgrade,
    upgrade_thresholds: { roas_min: input.upgrade.roasMin, gmv_min: input.upgrade.gmvMin },
  };
}

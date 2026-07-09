/**
 * Module 0.5 §2.4 — 1-pass aggregation over parsed MCN rows (in-memory, no DB
 * round-trip). Pure functions, unit-testable without Supabase. Consumed by
 * run.ts to produce creator_period_summary / creator_subcat_segment_gmv /
 * creator_top_products in a single read of the parsed rows.
 *
 * Price segmentation reuses the shared M5/M6 implementation (priceSegmentOf +
 * PriceBounds from src/lib/projection/gmv.ts) — CLAUDE.md forbids a second
 * segmentation implementation and forbids hardcoded thresholds; bounds are
 * passed in by the caller from app_config `segments.price_bounds`.
 *
 * NOTE on `McnRow.creatorName`: these functions group by that field's raw
 * string value — they don't know or care whether it is a display name or a
 * resolved creators.id. run.ts resolves creator names to creators.id via
 * resolveCreatorNames() BEFORE calling these functions and overwrites each
 * row's `creatorName` with the resolved id, so the grouping key here ends up
 * being creator_id in production. Unit tests below pass creator ids directly
 * in that same field for the same reason.
 */
import { priceSegmentOf, type PriceBounds, type PriceSegment } from "@/lib/projection/gmv";
import type { McnRow } from "./schema";

export interface PeriodSummaryRow {
  creatorId: string;
  periodStart: string;
  periodEnd: string;
  gmvTotal: number;
  affiliateGmv: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
  liveOrders: number;
  videoOrders: number;
  orders: number;
  itemsSold: number;
  directGmv: number;
  refundGmv: number;
  ctr: number | null;
  ctor: number | null;
  livePct: number | null;
}

/**
 * Per-creator rollup across the whole batch (Module 0.5 §2.3):
 * live_pct = affiliate_live_gmv / affiliate_gmv (guard div-0 → null).
 * ctr/ctor = weighted average BY GMV (a row's CTR/CTOR is per-product; weighting
 * by that product's GMV keeps the average representative of where the money is,
 * consistent across ctr and ctor per spec instruction). gmv_total = affiliate_gmv
 * (the platform report carries no separate "total order GMV" column beyond
 * affiliate + direct; gmv_total mirrors affiliate_gmv while direct_gmv is kept
 * as its own field — see Open Assumptions in the final report).
 */
export function buildPeriodSummary(rows: McnRow[]): PeriodSummaryRow[] {
  interface Acc {
    creatorId: string;
    periodStart: string;
    periodEnd: string;
    affiliateGmv: number;
    affiliateLiveGmv: number;
    affiliateVideoGmv: number;
    liveOrders: number;
    videoOrders: number;
    orders: number;
    itemsSold: number;
    directGmv: number;
    refundGmv: number;
    ctrWeighted: number; // sum(ctr * gmv)
    ctorWeighted: number; // sum(ctor * gmv)
  }
  const byCreator = new Map<string, Acc>();

  for (const r of rows) {
    if (!r.creatorName && !r.periodStart) continue; // caller resolves creatorName -> id before calling in run.ts
    const key = r.creatorName;
    if (!key) continue;
    const acc = byCreator.get(key) ?? {
      creatorId: key,
      periodStart: r.periodStart ?? "",
      periodEnd: r.periodEnd ?? "",
      affiliateGmv: 0,
      affiliateLiveGmv: 0,
      affiliateVideoGmv: 0,
      liveOrders: 0,
      videoOrders: 0,
      orders: 0,
      itemsSold: 0,
      directGmv: 0,
      refundGmv: 0,
      ctrWeighted: 0,
      ctorWeighted: 0,
    };
    if (r.periodStart && (!acc.periodStart || r.periodStart < acc.periodStart)) acc.periodStart = r.periodStart;
    if (r.periodEnd && (!acc.periodEnd || r.periodEnd > acc.periodEnd)) acc.periodEnd = r.periodEnd;
    acc.affiliateGmv += r.affiliateGmv;
    acc.affiliateLiveGmv += r.affiliateLiveGmv;
    acc.affiliateVideoGmv += r.affiliateVideoGmv;
    acc.liveOrders += r.liveOrders;
    acc.videoOrders += r.videoOrders;
    acc.orders += r.orders;
    acc.itemsSold += r.itemsSold;
    acc.directGmv += r.directGmv;
    acc.refundGmv += r.refundGmv;
    if (r.ctr !== null) acc.ctrWeighted += r.ctr * r.affiliateGmv;
    if (r.ctor !== null) acc.ctorWeighted += r.ctor * r.affiliateGmv;
    byCreator.set(key, acc);
  }

  return [...byCreator.values()].map((acc) => ({
    creatorId: acc.creatorId,
    periodStart: acc.periodStart,
    periodEnd: acc.periodEnd,
    gmvTotal: acc.affiliateGmv,
    affiliateGmv: acc.affiliateGmv,
    affiliateLiveGmv: acc.affiliateLiveGmv,
    affiliateVideoGmv: acc.affiliateVideoGmv,
    liveOrders: acc.liveOrders,
    videoOrders: acc.videoOrders,
    orders: acc.orders,
    itemsSold: acc.itemsSold,
    directGmv: acc.directGmv,
    refundGmv: acc.refundGmv,
    ctr: acc.affiliateGmv > 0 ? acc.ctrWeighted / acc.affiliateGmv : null,
    ctor: acc.affiliateGmv > 0 ? acc.ctorWeighted / acc.affiliateGmv : null,
    livePct: acc.affiliateGmv > 0 ? acc.affiliateLiveGmv / acc.affiliateGmv : null,
  }));
}

export interface SubcatSegmentRow {
  creatorId: string;
  level2Category: string;
  priceSegment: PriceSegment | null;
  windowEnd: string;
  gmv: number;
  liveGmv: number;
  itemsSold: number;
  orders: number;
  avgPrice: number | null;
}

/**
 * Groups rows by (creator, level2 category, price segment). Segment is derived
 * PER PRODUCT ROW from that row's own avg_price (= affiliate_gmv / items_sold),
 * then rows sharing (creator, category, segment) are summed — matches Module
 * 0.5 §2.3/§2.6 ("segmen dihitung saat ingest dari avg_price"). items_sold=0
 * rows fall into the `null` segment bucket (GMV still counted, no div-by-zero).
 */
export function buildSubcatSegment(rows: McnRow[], bounds: PriceBounds): SubcatSegmentRow[] {
  interface Acc {
    creatorId: string;
    level2Category: string;
    priceSegment: PriceSegment | null;
    windowEnd: string;
    gmv: number;
    liveGmv: number;
    itemsSold: number;
    orders: number;
  }
  const byKey = new Map<string, Acc>();

  for (const r of rows) {
    if (!r.creatorName || !r.level2Category) continue;
    const segment: PriceSegment | null =
      r.itemsSold > 0 ? priceSegmentOf(r.affiliateGmv / r.itemsSold, bounds) : null;
    const key = `${r.creatorName}|${r.level2Category.toLowerCase()}|${segment ?? "null"}`;
    const acc = byKey.get(key) ?? {
      creatorId: r.creatorName,
      level2Category: r.level2Category,
      priceSegment: segment,
      windowEnd: r.periodEnd ?? "",
      gmv: 0,
      liveGmv: 0,
      itemsSold: 0,
      orders: 0,
    };
    if (r.periodEnd && r.periodEnd > acc.windowEnd) acc.windowEnd = r.periodEnd;
    acc.gmv += r.affiliateGmv;
    acc.liveGmv += r.affiliateLiveGmv;
    acc.itemsSold += r.itemsSold;
    acc.orders += r.orders;
    byKey.set(key, acc);
  }

  return [...byKey.values()].map((acc) => ({
    creatorId: acc.creatorId,
    level2Category: acc.level2Category,
    priceSegment: acc.priceSegment,
    windowEnd: acc.windowEnd,
    gmv: acc.gmv,
    liveGmv: acc.liveGmv,
    itemsSold: acc.itemsSold,
    orders: acc.orders,
    avgPrice: acc.itemsSold > 0 ? acc.gmv / acc.itemsSold : null,
  }));
}

export interface TopProductRow {
  creatorId: string;
  periodStart: string;
  periodEnd: string;
  rank: number;
  productId: string;
  productInfo: string | null;
  shopId: string;
  level2Category: string | null;
  gmv: number;
  orders: number;
}

/**
 * Sums each (creator, product) across all days in the batch, ranks by GMV desc
 * per creator, keeps only the top N (Module 0.5 §2.3, default 20 from
 * app_config ingest.top_n_products) — the rest is discarded (drop-raw intent).
 */
export function buildTopProducts(rows: McnRow[], topN: number): TopProductRow[] {
  interface Acc {
    creatorId: string;
    periodStart: string;
    periodEnd: string;
    productId: string;
    productInfo: string | null;
    shopId: string;
    level2Category: string | null;
    gmv: number;
    orders: number;
  }
  const byKey = new Map<string, Acc>();

  for (const r of rows) {
    if (!r.creatorName) continue;
    const key = `${r.creatorName}|${r.productId}|${r.shopId}`;
    const acc = byKey.get(key) ?? {
      creatorId: r.creatorName,
      periodStart: r.periodStart ?? "",
      periodEnd: r.periodEnd ?? "",
      productId: r.productId,
      productInfo: r.productInfo,
      shopId: r.shopId,
      level2Category: r.level2Category,
      gmv: 0,
      orders: 0,
    };
    if (r.periodStart && (!acc.periodStart || r.periodStart < acc.periodStart)) acc.periodStart = r.periodStart;
    if (r.periodEnd && r.periodEnd > acc.periodEnd) acc.periodEnd = r.periodEnd;
    if (!acc.productInfo && r.productInfo) acc.productInfo = r.productInfo;
    acc.gmv += r.affiliateGmv;
    acc.orders += r.orders;
    byKey.set(key, acc);
  }

  const byCreator = new Map<string, Acc[]>();
  for (const acc of byKey.values()) {
    const list = byCreator.get(acc.creatorId) ?? [];
    list.push(acc);
    byCreator.set(acc.creatorId, list);
  }

  const out: TopProductRow[] = [];
  for (const list of byCreator.values()) {
    list.sort((a, b) => b.gmv - a.gmv);
    list.slice(0, topN).forEach((acc, i) => {
      out.push({
        creatorId: acc.creatorId,
        periodStart: acc.periodStart,
        periodEnd: acc.periodEnd,
        rank: i + 1,
        productId: acc.productId,
        productInfo: acc.productInfo,
        shopId: acc.shopId,
        level2Category: acc.level2Category,
        gmv: acc.gmv,
        orders: acc.orders,
      });
    });
  }
  return out;
}

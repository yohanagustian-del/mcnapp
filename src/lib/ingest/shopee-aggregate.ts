/**
 * Shopee Lane 1 aggregation (CLAUDE.md task spec rule #4) — 1-pass, in-memory,
 * pure functions (unit-testable without Supabase), mirroring src/lib/ingest/
 * aggregate.ts's role for the TikTok pipeline. Aggregate = weekly GMV summary
 * ONLY: no subcat/segment/top-products tables for Shopee yet (task decision —
 * TikTok-only for now).
 *
 * NOTE on `ShopeeRow.affiliateUsername` after resolution: shopee-run.ts resolves
 * usernames to creators.id via resolveCreatorNamesByPlatform() BEFORE calling
 * buildShopeePeriodSummary and overwrites each row's `affiliateUsername` with
 * the resolved id, so the grouping key here ends up being creator_id in
 * production (same convention as McnRow.creatorName in aggregate.ts).
 */
import type { ShopeeRow } from "./shopee-csv";

export interface ShopeePeriodSummaryRow {
  creatorId: string;
  periodStart: string;
  periodEnd: string;
  gmvTotal: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
  orders: number;
}

/**
 * Per-creator rollup across the whole file: gmv_total = sum of ALL Selesai rows
 * (live + video + other, e.g. WhatsApp); affiliate_live_gmv = sum of rows whose
 * Platform contains "live"; affiliate_video_gmv = sum of rows whose Platform
 * contains "video". `orders` = row count (Shopee Conversion Report is one row
 * per order-line, unlike the TikTok MCN report which is a pre-aggregate).
 *
 * periodStart/periodEnd are passed in (the caller has already validated all
 * rows collapse into a single W1-W5 window and computed the window's canonical
 * boundary dates via validateSingleShopeeWindow) rather than derived per-row,
 * since every row in `rows` is guaranteed to belong to the same window by the
 * time this runs.
 */
export function buildShopeePeriodSummary(
  rows: ShopeeRow[],
  periodStart: string,
  periodEnd: string
): ShopeePeriodSummaryRow[] {
  interface Acc {
    creatorId: string;
    gmvTotal: number;
    affiliateLiveGmv: number;
    affiliateVideoGmv: number;
    orders: number;
  }
  const byCreator = new Map<string, Acc>();

  for (const r of rows) {
    const key = r.affiliateUsername;
    if (!key) continue;
    const acc = byCreator.get(key) ?? {
      creatorId: key,
      gmvTotal: 0,
      affiliateLiveGmv: 0,
      affiliateVideoGmv: 0,
      orders: 0,
    };
    acc.gmvTotal += r.gmv;
    if (r.bucket === "live") acc.affiliateLiveGmv += r.gmv;
    else if (r.bucket === "video") acc.affiliateVideoGmv += r.gmv;
    acc.orders += 1;
    byCreator.set(key, acc);
  }

  return [...byCreator.values()].map((acc) => ({
    creatorId: acc.creatorId,
    periodStart,
    periodEnd,
    gmvTotal: acc.gmvTotal,
    affiliateLiveGmv: acc.affiliateLiveGmv,
    affiliateVideoGmv: acc.affiliateVideoGmv,
    orders: acc.orders,
  }));
}

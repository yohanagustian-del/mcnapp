/**
 * Shopee Lane 1 aggregation (CLAUDE.md task spec rule #4) — 1-pass, in-memory,
 * pure functions (unit-testable without Supabase), mirroring src/lib/ingest/
 * aggregate.ts's role for the TikTok pipeline. Weekly GMV summary
 * (buildShopeePeriodSummary) plus category GMV (buildShopeeSubcatSegment,
 * added once a normalized Shopee category list existed to map
 * `kategori_l2` against — see shopee-category.ts). Still no top-products or
 * price-segment for Shopee: the Conversion Report has no per-item
 * price/quantity to derive `price_segment` from safely (CLAUDE.md #7 — don't
 * guess at dirty/incomplete data), so `priceSegment` stays null on every row.
 *
 * NOTE on `ShopeeRow.affiliateUsername` after resolution: shopee-run.ts resolves
 * usernames to creators.id via resolveCreatorNamesByPlatform() BEFORE calling
 * buildShopeePeriodSummary and overwrites each row's `affiliateUsername` with
 * the resolved id, so the grouping key here ends up being creator_id in
 * production (same convention as McnRow.creatorName in aggregate.ts).
 */
import type { ShopeeRow } from "./shopee-csv";
import type { SubcatSegmentRow } from "./aggregate";
import { normalizeShopeeCategory } from "./shopee-category";

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

/**
 * Groups rows by (creator, normalized level2 category) → GMV/live-GMV/orders
 * per category, in the same SubcatSegmentRow shape aggregate.ts's TikTok-side
 * buildSubcatSegment produces (CLAUDE.md #4 — one row shape feeding
 * creator_subcat_segment_gmv, whichever platform wrote it). `priceSegment` is
 * always null and `itemsSold`/`avgPrice` stay at their neutral defaults — see
 * the module doc for why. Rows whose category doesn't match the official
 * Shopee list (normalizeShopeeCategory returns null — blank or unrecognized
 * text) are excluded rather than counted under a guessed category.
 */
export function buildShopeeSubcatSegment(rows: ShopeeRow[], windowEnd: string): SubcatSegmentRow[] {
  interface Acc {
    creatorId: string;
    level2Category: string;
    gmv: number;
    liveGmv: number;
    orders: number;
  }
  const byKey = new Map<string, Acc>();

  for (const r of rows) {
    const category = normalizeShopeeCategory(r.level2Category);
    if (!r.affiliateUsername || !category) continue;
    const key = `${r.affiliateUsername}|${category.toLowerCase()}`;
    const acc = byKey.get(key) ?? {
      creatorId: r.affiliateUsername,
      level2Category: category,
      gmv: 0,
      liveGmv: 0,
      orders: 0,
    };
    acc.gmv += r.gmv;
    if (r.bucket === "live") acc.liveGmv += r.gmv;
    acc.orders += 1;
    byKey.set(key, acc);
  }

  return [...byKey.values()].map((acc) => ({
    creatorId: acc.creatorId,
    level2Category: acc.level2Category,
    priceSegment: null,
    windowEnd,
    gmv: acc.gmv,
    liveGmv: acc.liveGmv,
    itemsSold: 0,
    orders: acc.orders,
    avgPrice: null,
  }));
}

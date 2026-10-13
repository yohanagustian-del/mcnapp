/**
 * Shopee Lane 1 aggregation (CLAUDE.md task spec rule #4) — 1-pass, in-memory,
 * pure functions (unit-testable without Supabase), mirroring src/lib/ingest/
 * aggregate.ts's role for the TikTok pipeline. Weekly GMV summary
 * (buildShopeePeriodSummary) plus category GMV (buildShopeeSubcatSegment,
 * added once a normalized Shopee category list existed to map
 * `kategori_l2` against — see shopee-category.ts). Still no top-products for
 * Shopee. Price segment: derived per order-line from `Harga(Rp)` (unit price),
 * falling back to gmv/Qty, else null (REVISI_BIZDEV T2 — the old claim that the
 * report had no price/quantity was wrong: both columns exist in the export).
 *
 * NOTE on `ShopeeRow.affiliateUsername` after resolution: shopee-run.ts resolves
 * usernames to creators.id via resolveCreatorNamesByPlatform() BEFORE calling
 * buildShopeePeriodSummary and overwrites each row's `affiliateUsername` with
 * the resolved id, so the grouping key here ends up being creator_id in
 * production (same convention as McnRow.creatorName in aggregate.ts).
 */
import type { ShopeeRow } from "./shopee-csv";
import type { CreatorShopPeriodRow, SubcatSegmentRow } from "./aggregate";
import { normalizeShopId } from "@/lib/m4/leak-compute";
import { priceSegmentOf, type PriceBounds, type PriceSegment } from "@/lib/projection/gmv";
import { normalizeShopeeCategory } from "./shopee-category";

export interface ShopeePeriodSummaryRow {
  creatorId: string;
  periodStart: string;
  periodEnd: string;
  gmvTotal: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
  orders: number;
  /** Σ Qty of rows with a readable Qty (rows with blank Qty add 0, not a guess). */
  itemsSold: number;
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
    itemsSold: number;
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
      itemsSold: 0,
    };
    acc.gmvTotal += r.gmv;
    if (r.bucket === "live") acc.affiliateLiveGmv += r.gmv;
    else if (r.bucket === "video") acc.affiliateVideoGmv += r.gmv;
    acc.orders += 1;
    acc.itemsSold += r.qty ?? 0;
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
    itemsSold: acc.itemsSold,
  }));
}

/**
 * Price segment of one Shopee order-line: unit price `Harga(Rp)` when readable,
 * else gmv/Qty, else null. Same priceSegmentOf + app_config bounds as TikTok
 * (CLAUDE.md #8 — one segmentation implementation).
 */
export function shopeeRowSegment(r: ShopeeRow, bounds: PriceBounds): PriceSegment | null {
  if (r.unitPrice !== null && r.unitPrice > 0) return priceSegmentOf(r.unitPrice, bounds);
  if (r.qty !== null && r.qty > 0 && r.gmv > 0) return priceSegmentOf(r.gmv / r.qty, bounds);
  return null;
}

/**
 * Groups rows by (creator, normalized level2 category, price segment) → GMV/
 * live-GMV/orders/items, in the same SubcatSegmentRow shape aggregate.ts's
 * TikTok-side buildSubcatSegment produces (CLAUDE.md #4 — one row shape feeding
 * creator_subcat_segment_gmv, whichever platform wrote it). The segment is
 * derived PER ORDER-LINE (shopeeRowSegment) and is part of the group key, exactly
 * like TikTok. Rows whose category doesn't match the official Shopee list
 * (normalizeShopeeCategory returns null — blank or unrecognized text) are
 * excluded rather than counted under a guessed category.
 */
export function buildShopeeSubcatSegment(
  rows: ShopeeRow[],
  windowEnd: string,
  bounds: PriceBounds
): SubcatSegmentRow[] {
  interface Acc {
    creatorId: string;
    level2Category: string;
    priceSegment: PriceSegment | null;
    gmv: number;
    liveGmv: number;
    orders: number;
    itemsSold: number;
  }
  const byKey = new Map<string, Acc>();

  for (const r of rows) {
    const category = normalizeShopeeCategory(r.level2Category);
    if (!r.affiliateUsername || !category) continue;
    const segment = shopeeRowSegment(r, bounds);
    const key = `${r.affiliateUsername}|${category.toLowerCase()}|${segment ?? "null"}`;
    const acc = byKey.get(key) ?? {
      creatorId: r.affiliateUsername,
      level2Category: category,
      priceSegment: segment,
      gmv: 0,
      liveGmv: 0,
      orders: 0,
      itemsSold: 0,
    };
    acc.gmv += r.gmv;
    if (r.bucket === "live") acc.liveGmv += r.gmv;
    acc.orders += 1;
    acc.itemsSold += r.qty ?? 0;
    byKey.set(key, acc);
  }

  return [...byKey.values()].map((acc) => ({
    creatorId: acc.creatorId,
    level2Category: acc.level2Category,
    priceSegment: acc.priceSegment,
    windowEnd,
    gmv: acc.gmv,
    liveGmv: acc.liveGmv,
    itemsSold: acc.itemsSold,
    orders: acc.orders,
    avgPrice: acc.itemsSold > 0 ? acc.gmv / acc.itemsSold : null,
  }));
}

/**
 * creator_shop_period_gmv rows for Shopee (migrasi 0087, REVISI_BIZDEV T4): GMV
 * MCN per (creator, shop) from the same Selesai rows. TAP columns stay NULL —
 * fase 1 = TikTok saja (Q4): the SAP marker column is not confirmed yet, so the
 * UI must say "GMV TAP belum tersedia untuk Shopee", never show 0.
 */
export function buildShopeeCreatorShopPeriod(rows: ShopeeRow[]): CreatorShopPeriodRow[] {
  const byKey = new Map<string, CreatorShopPeriodRow>();
  for (const r of rows) {
    if (!r.affiliateUsername || !r.shopId) continue;
    const shop = normalizeShopId(r.shopId);
    const key = `${r.affiliateUsername}|${shop}`;
    const acc = byKey.get(key) ?? {
      creatorId: r.affiliateUsername, shopId: shop, shopName: r.shopName,
      gmvMcn: 0, gmvMcnLive: 0, gmvMcnVideo: 0, ordersMcn: 0, itemsSoldMcn: 0,
      gmvTap: null, gmvTapLive: null, gmvTapVideo: null, ordersTap: null,
      estPartnerCommission: null, actualPartnerCommission: null,
      estCreatorCommission: null, actualCreatorCommission: null,
    };
    if (!acc.shopName && r.shopName) acc.shopName = r.shopName;
    acc.gmvMcn += r.gmv;
    if (r.bucket === "live") acc.gmvMcnLive += r.gmv;
    else if (r.bucket === "video") acc.gmvMcnVideo += r.gmv;
    acc.ordersMcn += 1;
    acc.itemsSoldMcn += r.qty ?? 0;
    byKey.set(key, acc);
  }
  return [...byKey.values()];
}


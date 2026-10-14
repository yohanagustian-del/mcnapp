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
import type { McnRow, TapRow } from "./schema";
import { normalizeShopId } from "@/lib/m4/leak-compute";

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
  /** PLAN_MSDPS Paket E — closing langsung saat siaran (migrasi 0074). */
  liveDirectGmv: number;
  liveDirectOrders: number;
  liveItemsSold: number;
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
    liveDirectGmv: number;
    liveDirectOrders: number;
    liveItemsSold: number;
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
      liveDirectGmv: 0,
      liveDirectOrders: 0,
      liveItemsSold: 0,
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
    acc.liveDirectGmv += r.liveDirectGmv;
    acc.liveDirectOrders += r.liveDirectOrders;
    acc.liveItemsSold += r.liveItemsSold;
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
    liveDirectGmv: acc.liveDirectGmv,
    liveDirectOrders: acc.liveDirectOrders,
    liveItemsSold: acc.liveItemsSold,
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

/** Unit price used for a TikTok row's segment: gmv/items_sold, else gmv/orders (Q5), else null. */
export function tiktokRowUnitPrice(r: Pick<McnRow, "affiliateGmv" | "itemsSold" | "orders">): number | null {
  if (r.itemsSold > 0) return r.affiliateGmv / r.itemsSold;
  if (r.orders > 0) return r.affiliateGmv / r.orders;
  return null;
}

/**
 * Groups rows by (creator, level2 category, price segment). Segment is derived
 * PER PRODUCT ROW from that row's own avg_price (= affiliate_gmv / items_sold),
 * then rows sharing (creator, category, segment) are summed — matches Module
 * 0.5 §2.3/§2.6 ("segmen dihitung saat ingest dari avg_price").
 *
 * Fallback (keputusan user Q5, REVISI_BIZDEV 2026-10): a row with items_sold=0
 * but orders>0 (±17% of weekly GMV in production) is priced by gmv/orders — an
 * approximation (one order may hold several items), used only because the
 * alternative is no segment at all. Rows with neither items nor orders still
 * fall into the `null` segment bucket (GMV still counted, no div-by-zero).
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
    const unitPrice = tiktokRowUnitPrice(r);
    const segment: PriceSegment | null = unitPrice !== null ? priceSegmentOf(unitPrice, bounds) : null;
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
    // Same fallback as the segment (Q5): gmv/orders when the group sold no counted items.
    avgPrice: acc.itemsSold > 0 ? acc.gmv / acc.itemsSold : acc.orders > 0 ? acc.gmv / acc.orders : null,
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
  shopName: string | null;
  level1Category: string | null;
  level2Category: string | null;
  gmv: number;
  orders: number;
  /**
   * Dimensi produk untuk report M2 v2 (migrasi 0066): pecahan live/video,
   * item, direct GMV, dan CTR/CTOR berbobot GMV. Semua berasal dari baris
   * file MCN yang sama — sebelumnya dibuang saat ingest.
   */
  liveGmv: number;
  videoGmv: number;
  itemsSold: number;
  liveOrders: number;
  videoOrders: number;
  directGmv: number;
  ctr: number | null;
  ctor: number | null;
  /** PLAN_MSDPS Paket E — closing langsung saat siaran, per produk (migrasi 0074). */
  liveDirectGmv: number;
  liveDirectOrders: number;
  liveItemsSold: number;
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
    shopName: string | null;
    level1Category: string | null;
    level2Category: string | null;
    gmv: number;
    orders: number;
    liveGmv: number;
    videoGmv: number;
    itemsSold: number;
    liveOrders: number;
    videoOrders: number;
    directGmv: number;
    ctrWeighted: number; // sum(ctr * gmv) — bobot yang sama dengan buildPeriodSummary
    ctorWeighted: number;
    weightedGmv: number; // gmv baris yang punya ctr/ctor (penyebut rata-rata berbobot)
    liveDirectGmv: number;
    liveDirectOrders: number;
    liveItemsSold: number;
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
      shopName: r.shopName,
      level1Category: r.level1Category,
      level2Category: r.level2Category,
      gmv: 0,
      orders: 0,
      liveGmv: 0,
      videoGmv: 0,
      itemsSold: 0,
      liveOrders: 0,
      videoOrders: 0,
      directGmv: 0,
      ctrWeighted: 0,
      ctorWeighted: 0,
      weightedGmv: 0,
      liveDirectGmv: 0,
      liveDirectOrders: 0,
      liveItemsSold: 0,
    };
    if (r.periodStart && (!acc.periodStart || r.periodStart < acc.periodStart)) acc.periodStart = r.periodStart;
    if (r.periodEnd && r.periodEnd > acc.periodEnd) acc.periodEnd = r.periodEnd;
    if (!acc.productInfo && r.productInfo) acc.productInfo = r.productInfo;
    if (!acc.shopName && r.shopName) acc.shopName = r.shopName;
    if (!acc.level1Category && r.level1Category) acc.level1Category = r.level1Category;
    acc.gmv += r.affiliateGmv;
    acc.orders += r.orders;
    acc.liveGmv += r.affiliateLiveGmv;
    acc.videoGmv += r.affiliateVideoGmv;
    acc.itemsSold += r.itemsSold;
    acc.liveOrders += r.liveOrders;
    acc.videoOrders += r.videoOrders;
    acc.directGmv += r.directGmv;
    acc.liveDirectGmv += r.liveDirectGmv;
    acc.liveDirectOrders += r.liveDirectOrders;
    acc.liveItemsSold += r.liveItemsSold;
    if (r.ctr !== null || r.ctor !== null) {
      // Baris ber-GMV nol tetap dihitung dengan bobot minimal supaya produk yang
      // hanya diklik (belum laku) tidak kehilangan CTR-nya sama sekali.
      const w = r.affiliateGmv > 0 ? r.affiliateGmv : 1;
      if (r.ctr !== null) acc.ctrWeighted += r.ctr * w;
      if (r.ctor !== null) acc.ctorWeighted += r.ctor * w;
      acc.weightedGmv += w;
    }
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
        shopName: acc.shopName,
        level1Category: acc.level1Category,
        level2Category: acc.level2Category,
        gmv: acc.gmv,
        orders: acc.orders,
        liveGmv: acc.liveGmv,
        videoGmv: acc.videoGmv,
        itemsSold: acc.itemsSold,
        liveOrders: acc.liveOrders,
        videoOrders: acc.videoOrders,
        directGmv: acc.directGmv,
        ctr: acc.weightedGmv > 0 ? acc.ctrWeighted / acc.weightedGmv : null,
        ctor: acc.weightedGmv > 0 ? acc.ctorWeighted / acc.weightedGmv : null,
        liveDirectGmv: acc.liveDirectGmv,
        liveDirectOrders: acc.liveDirectOrders,
        liveItemsSold: acc.liveItemsSold,
      });
    });
  }
  return out;
}

// ============ Kreator × shop × periode (migrasi 0087, REVISI_BIZDEV T4) ============

/** One row of creator_shop_period_gmv (platform/period/batch stamped by the writer). */
export interface CreatorShopPeriodRow {
  creatorId: string;
  shopId: string;
  shopName: string | null;
  gmvMcn: number;
  gmvMcnLive: number;
  gmvMcnVideo: number;
  ordersMcn: number;
  itemsSoldMcn: number;
  /** null = no TAP data for this upload/platform (not zero). */
  gmvTap: number | null;
  gmvTapLive: number | null;
  gmvTapVideo: number | null;
  ordersTap: number | null;
  estPartnerCommission: number | null;
  actualPartnerCommission: number | null;
  estCreatorCommission: number | null;
  actualCreatorCommission: number | null;
}

/**
 * TAP GMV per shop that could not be tied to a creator of this file (K6, user
 * 2026-10-14): stored in creator_shop_period_unattributed_tap (migrasi 0088) and
 * counted in the shop's GMV TAP as "Nama kreator tidak ada" — never split or guessed.
 */
export interface UnattributedTapShopRow {
  shopId: string;
  shopName: string | null;
  gmvTap: number;
  gmvTapLive: number;
  gmvTapVideo: number;
  ordersTap: number;
  estPartnerCommission: number | null;
  actualPartnerCommission: number | null;
  estCreatorCommission: number | null;
  actualCreatorCommission: number | null;
}

export interface CreatorShopPeriodResult {
  rows: CreatorShopPeriodRow[];
  /** Per-shop TAP GMV without a known creator (see UnattributedTapShopRow). */
  unattributed: UnattributedTapShopRow[];
  /** Σ unattributed[].gmvTap — reported in the upload result. */
  unattributedTapGmv: number;
}

const addNullable = (a: number | null, b: number | null): number | null =>
  b === null ? a : (a ?? 0) + b;

/**
 * Builds creator_shop_period_gmv rows from the SAME parsed MCN + TAP rows the
 * aggregates and the leak analysis use (no re-parse, CLAUDE.md #4). Pure.
 *
 * - `mcnRows[].creatorName` = resolved creator_id (run.ts convention).
 * - `tapRows[].creatorName` = resolved creator_id, "" for the 1-creator TAP export
 *   variant without a creator column (CLAUDE.md #5), or null when the name could
 *   not be resolved (that GMV is reported in `unattributedTapGmv`).
 * - Nameless TAP rows: single-creator file → that creator (CLAUDE.md #5). In a
 *   multi-creator file they are NOT split proportionally any more (K6 = user
 *   decision 2026-10-14): like unresolved names (null) they go to `unattributed`
 *   per shop, labelled "Nama kreator tidak ada" downstream, GMV still counted.
 * - `hasTap = false` (no TAP file uploaded) → every TAP column is null; with a TAP
 *   file, a creator×shop without TAP rows gets 0 (TAP known, just unused).
 *
 * Invariants (tested): Σ gmvMcn per creator = buildPeriodSummary(...).affiliateGmv;
 * Σ gmvTap + unattributedTapGmv = Σ TAP affiliate GMV.
 */
export function buildCreatorShopPeriod(
  mcnRows: McnRow[],
  tapRows: (Omit<TapRow, "creatorName"> & { creatorName: string | null })[],
  hasTap: boolean
): CreatorShopPeriodResult {
  const byKey = new Map<string, CreatorShopPeriodRow>();
  const tapInit = hasTap ? 0 : null;
  const get = (creatorId: string, shopId: string, shopName: string | null): CreatorShopPeriodRow => {
    const key = `${creatorId}|${shopId}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        creatorId, shopId, shopName,
        gmvMcn: 0, gmvMcnLive: 0, gmvMcnVideo: 0, ordersMcn: 0, itemsSoldMcn: 0,
        gmvTap: tapInit, gmvTapLive: tapInit, gmvTapVideo: tapInit, ordersTap: tapInit,
        estPartnerCommission: null, actualPartnerCommission: null,
        estCreatorCommission: null, actualCreatorCommission: null,
      };
      byKey.set(key, acc);
    }
    if (!acc.shopName && shopName) acc.shopName = shopName;
    return acc;
  };

  for (const r of mcnRows) {
    if (!r.creatorName || !r.shopId) continue;
    const shop = normalizeShopId(r.shopId);
    const acc = get(r.creatorName, shop, r.shopName);
    acc.gmvMcn += r.affiliateGmv;
    acc.gmvMcnLive += r.affiliateLiveGmv;
    acc.gmvMcnVideo += r.affiliateVideoGmv;
    acc.ordersMcn += r.orders;
    acc.itemsSoldMcn += r.itemsSold;
  }

  const mcnCreators = new Set(mcnRows.map((r) => r.creatorName).filter(Boolean));
  const singleCreator = mcnCreators.size === 1 ? [...mcnCreators][0] : null;
  const unattributed = new Map<string, UnattributedTapShopRow>();

  const addTap = (acc: CreatorShopPeriodRow, t: TapRow | Omit<TapRow, "creatorName">) => {
    acc.gmvTap = (acc.gmvTap ?? 0) + t.affiliateGmv;
    acc.gmvTapLive = (acc.gmvTapLive ?? 0) + t.affiliateLiveGmv;
    acc.gmvTapVideo = (acc.gmvTapVideo ?? 0) + t.affiliateVideoGmv;
    acc.ordersTap = (acc.ordersTap ?? 0) + t.orders;
    acc.estPartnerCommission = addNullable(acc.estPartnerCommission, t.estPartnerCommission);
    acc.actualPartnerCommission = addNullable(acc.actualPartnerCommission, t.actualPartnerCommission);
    acc.estCreatorCommission = addNullable(acc.estCreatorCommission, t.estCreatorCommission);
    acc.actualCreatorCommission = addNullable(acc.actualCreatorCommission, t.actualCreatorCommission);
  };
  const addUnattributed = (shop: string, t: TapRow | Omit<TapRow, "creatorName">) => {
    const u =
      unattributed.get(shop) ??
      {
        shopId: shop, shopName: t.shopName, gmvTap: 0, gmvTapLive: 0, gmvTapVideo: 0, ordersTap: 0,
        estPartnerCommission: null, actualPartnerCommission: null, estCreatorCommission: null, actualCreatorCommission: null,
      };
    if (!u.shopName && t.shopName) u.shopName = t.shopName;
    u.gmvTap += t.affiliateGmv;
    u.gmvTapLive += t.affiliateLiveGmv;
    u.gmvTapVideo += t.affiliateVideoGmv;
    u.ordersTap += t.orders;
    u.estPartnerCommission = addNullable(u.estPartnerCommission, t.estPartnerCommission);
    u.actualPartnerCommission = addNullable(u.actualPartnerCommission, t.actualPartnerCommission);
    u.estCreatorCommission = addNullable(u.estCreatorCommission, t.estCreatorCommission);
    u.actualCreatorCommission = addNullable(u.actualCreatorCommission, t.actualCreatorCommission);
    unattributed.set(shop, u);
  };

  if (hasTap) {
    for (const t of tapRows) {
      if (!t.shopId) continue;
      const shop = normalizeShopId(t.shopId);
      if (t.creatorName) addTap(get(t.creatorName, shop, t.shopName), t);
      else if (t.creatorName === "" && singleCreator) addTap(get(singleCreator, shop, t.shopName), t);
      else addUnattributed(shop, t);
    }
  }

  const unattributedRows = [...unattributed.values()];
  return {
    rows: [...byKey.values()],
    unattributed: unattributedRows,
    unattributedTapGmv: unattributedRows.reduce((sum, u) => sum + u.gmvTap, 0),
  };
}


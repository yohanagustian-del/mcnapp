/**
 * Shared GMV projection engine — ONE implementation used by M5 (Matching) and
 * M6 (Deal Value Predictor). PRD Module 05 §2.3 / Module 06 §2.2: basis = the
 * creator's historical GMV over a rolling window (default 28 days) on the same
 * (Level 2 sub-category, price segment), adjusted by a level factor, always
 * returned as a range (min–max) with a disclaimer — never a single number.
 *
 * Deterministic only: aggregation + formula. NO LLM anywhere in this module.
 * All tunables (window, spread, level factors, segment bounds) come from
 * app_config — never hardcoded here.
 */

export type PriceSegment = "low" | "entry" | "sweet" | "high" | "premium";

/** Upper bounds (Rp) per segment; above `high` = premium. From app_config `segments.price_bounds`. */
export interface PriceBounds {
  low: number;    // < low            → low-ticket
  entry: number;  // [low, entry)     → entry/mid-low
  sweet: number;  // [entry, sweet)   → sweet spot
  high: number;   // [sweet, high)    → high-ticket; >= high → premium
}

export function priceSegmentOf(unitPrice: number, bounds: PriceBounds): PriceSegment {
  if (unitPrice < bounds.low) return "low";
  if (unitPrice < bounds.entry) return "entry";
  if (unitPrice < bounds.sweet) return "sweet";
  if (unitPrice < bounds.high) return "high";
  return "premium";
}

/** One aggregate product row from transactions_all (platform data, per product/period). */
export interface TxHistoryRow {
  creator_id: string | null;
  level2_category: string | null;
  affiliate_gmv: number | null;
  affiliate_live_gmv: number | null;
  items_sold: number | null;
}

export interface CreatorTotals {
  gmv: number;
  liveGmv: number;
}

export interface HistoryAggregate {
  /** `${creatorId}|${subcat lower}|${segment}` → GMV */
  bySlot: Map<string, number>;
  /** `${creatorId}|${subcat lower}` → GMV (all segments) */
  bySubcat: Map<string, number>;
  /** creatorId → window totals (GMV & live GMV, all categories) */
  totals: Map<string, CreatorTotals>;
}

export const slotKey = (creatorId: string, subCategory: string, segment: PriceSegment) =>
  `${creatorId}|${subCategory.trim().toLowerCase()}|${segment}`;
export const subcatKey = (creatorId: string, subCategory: string) =>
  `${creatorId}|${subCategory.trim().toLowerCase()}`;

/**
 * Buckets per-product platform rows into (creator, sub-category, price segment)
 * GMV sums. The platform export has no unit price column; price is derived as
 * affiliate_gmv / items_sold per aggregate product row (rows without items_sold
 * count toward sub-category & totals but not toward a price segment).
 */
export function aggregateHistory(rows: TxHistoryRow[], bounds: PriceBounds): HistoryAggregate {
  const bySlot = new Map<string, number>();
  const bySubcat = new Map<string, number>();
  const totals = new Map<string, CreatorTotals>();

  for (const row of rows) {
    if (!row.creator_id) continue;
    const gmv = row.affiliate_gmv ?? 0;
    if (gmv <= 0) continue;

    const t = totals.get(row.creator_id) ?? { gmv: 0, liveGmv: 0 };
    t.gmv += gmv;
    t.liveGmv += row.affiliate_live_gmv ?? 0;
    totals.set(row.creator_id, t);

    const subcat = row.level2_category?.trim();
    if (!subcat) continue;
    const sk = subcatKey(row.creator_id, subcat);
    bySubcat.set(sk, (bySubcat.get(sk) ?? 0) + gmv);

    if (row.items_sold && row.items_sold > 0) {
      const segment = priceSegmentOf(gmv / row.items_sold, bounds);
      const key = slotKey(row.creator_id, subcat, segment);
      bySlot.set(key, (bySlot.get(key) ?? 0) + gmv);
    }
  }
  return { bySlot, bySubcat, totals };
}

/**
 * One row from creator_subcat_segment_gmv (Module 0.5 §2.3) — ALREADY aggregated
 * per (creator, level2 category, price segment, window_end) at ingest time. This
 * is the Fase 2 basis for M5/M6, replacing a fresh aggregateHistory() pass over
 * per-product transactions_all rows (which get dropped after ingest — Module 0.5
 * §2.7 drop-raw). No items_sold guard needed here: price_segment is already
 * resolved (null when the source row had items_sold=0), unlike aggregateHistory
 * which derives it from raw rows.
 */
export interface SubcatSegmentGmvRow {
  creator_id: string | null;
  level2_category: string | null;
  price_segment: PriceSegment | null;
  gmv: number | null;
  live_gmv: number | null;
  /** Dipakai Product Match (categoryProfile) untuk AOV = gmv/orders; opsional untuk pemakai lama. */
  orders?: number | null;
}

/**
 * Builds the SAME HistoryAggregate shape as aggregateHistory(), but from
 * pre-aggregated creator_subcat_segment_gmv rows instead of raw per-product
 * transactions_all rows — so projectGmv()/matching/predictor can share one
 * lookup shape (bySlot/bySubcat/totals) regardless of source table
 * (CLAUDE.md #8: one implementation, no duplicate projection logic).
 * Rows with a null price_segment (items_sold=0 at ingest) still count toward
 * bySubcat & totals but not toward any bySlot entry — same rule as
 * aggregateHistory's items_sold=0 guard.
 */
export function aggregateFromSubcatSegmentRows(rows: SubcatSegmentGmvRow[]): HistoryAggregate {
  const bySlot = new Map<string, number>();
  const bySubcat = new Map<string, number>();
  const totals = new Map<string, CreatorTotals>();

  for (const row of rows) {
    if (!row.creator_id) continue;
    const gmv = row.gmv ?? 0;
    if (gmv <= 0) continue;

    const t = totals.get(row.creator_id) ?? { gmv: 0, liveGmv: 0 };
    t.gmv += gmv;
    t.liveGmv += row.live_gmv ?? 0;
    totals.set(row.creator_id, t);

    const subcat = row.level2_category?.trim();
    if (!subcat) continue;
    const sk = subcatKey(row.creator_id, subcat);
    bySubcat.set(sk, (bySubcat.get(sk) ?? 0) + gmv);

    if (row.price_segment) {
      const key = slotKey(row.creator_id, subcat, row.price_segment);
      bySlot.set(key, (bySlot.get(key) ?? 0) + gmv);
    }
  }
  return { bySlot, bySubcat, totals };
}

/** Level factor from app_config `projection.level_factors` (keys "1".."6"); unknown level → 1. */
export function levelFactorOf(
  level: number | null | undefined,
  factors: Record<string, number>
): number {
  if (level === null || level === undefined) return 1;
  const f = factors[String(level)];
  return typeof f === "number" && Number.isFinite(f) && f > 0 ? f : 1;
}

export interface ProjectionConfig {
  windowDays: number;                    // app_config projection.window_days
  spread: number;                        // app_config projection.spread (± fraction around basis)
  levelFactors: Record<string, number>;  // app_config projection.level_factors
  bounds: PriceBounds;                   // app_config segments.price_bounds
}

/** UI disclaimer (PRD M5 §2.3 / M6 §2.4) — always shown next to a projection. */
export const PROJECTION_DISCLAIMER =
  "Estimasi berdasarkan histori GMV creator (window berjalan) pada sub-kategori & segmen harga yang sama — " +
  "gambaran, bukan angka pasti atau jaminan. Akurasi meningkat seiring data menumpuk.";

export interface GmvProjection {
  min: number;
  max: number;
  /** Historical GMV over the window on the (sub-category, segment) slot. */
  basisGmv: number;
  levelFactor: number;
  durationFactor: number;
  /** Transparent method metadata (PRD M5 §2.3: stored so the formula can be refined). */
  method: string;
  disclaimer: string;
}

/**
 * THE projection formula (single source of truth, M5 & M6):
 *   base = basisGmv × levelFactor × (durationDays / windowDays)
 *   range = [base × (1 − spread), base × (1 + spread)]
 * No historical basis → {0, 0} (caller excludes/flags per M6 §2.3).
 */
export function projectGmvRange(
  basisGmv: number,
  level: number | null | undefined,
  cfg: ProjectionConfig,
  durationDays?: number
): GmvProjection {
  const levelFactor = levelFactorOf(level, cfg.levelFactors);
  const durationFactor =
    durationDays && durationDays > 0 && cfg.windowDays > 0 ? durationDays / cfg.windowDays : 1;
  const base = Math.max(basisGmv, 0) * levelFactor * durationFactor;
  return {
    min: Math.round(base * (1 - cfg.spread)),
    max: Math.round(base * (1 + cfg.spread)),
    basisGmv,
    levelFactor,
    durationFactor,
    method: `gmv_${cfg.windowDays}d(subkat,segmen) × faktor_level(${levelFactor}) × durasi(${durationFactor.toFixed(2)}) ± ${cfg.spread * 100}%`,
    disclaimer: PROJECTION_DISCLAIMER,
  };
}

/** Live share (% GMV dari live) — quality signal shown in M6 breakdowns. */
export function liveShareOf(totals: CreatorTotals | undefined): number | null {
  if (!totals || totals.gmv <= 0) return null;
  return Math.min(totals.liveGmv / totals.gmv, 1);
}

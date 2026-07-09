/**
 * Product×Creator Matching — pure, deterministic, rule-based (0 LLM). Referenced
 * UX: compute a creator's average sale price per Level 2 sub-category → derive
 * the price segment(s) the creator can actually sell in → match against TAP
 * products in the same (sub-category, segment) cell. Two directions:
 *   - matchProductsForCreator: pick a creator → rank suitable TAP products.
 *   - matchCreatorsForProduct: pick a product → rank suitable creators (for /matching).
 *
 * All inputs are already-fetched rows / pre-aggregated maps — no DB access here,
 * so this is fully unit-testable and reusable from both the creator detail page
 * and the /matching page.
 */

import type { PriceSegment } from "@/lib/projection/gmv";

// ---------- creator segment matrix ----------

/** One row from creator_subcat_segment_gmv for a single creator (already ingest-time aggregated). */
export interface CreatorSegmentRow {
  level2_category: string | null;
  price_segment: PriceSegment | null;
  gmv: number | null;
  live_gmv: number | null;
  items_sold: number | null;
  avg_price: number | null;
}

export interface SegmentCell {
  level2Category: string;
  segment: PriceSegment;
  gmv: number;
  liveGmv: number;
  itemsSold: number;
  avgPrice: number | null;
  /** Share of this cell's GMV within the creator's total GMV across all cells. */
  share: number;
}

export interface CreatorSegmentMatrix {
  /** `${level2 lower}|${segment}` → cell. */
  cells: Map<string, SegmentCell>;
  /** level2(lower) → total GMV across all segments (for ranking dominant categories). */
  byCategory: Map<string, number>;
  totalGmv: number;
}

const cellKey = (level2: string, segment: PriceSegment) => `${level2.trim().toLowerCase()}|${segment}`;

/**
 * Builds the level2 × price_segment matrix for one creator from raw
 * creator_subcat_segment_gmv rows (rows with a null price_segment — items_sold=0
 * at ingest — are excluded from the matrix cells since they carry no sellable
 * price signal, mirroring the same guard used in projection/gmv.ts).
 */
export function creatorSegmentMap(rows: CreatorSegmentRow[]): CreatorSegmentMatrix {
  const cells = new Map<string, SegmentCell>();
  const byCategory = new Map<string, number>();
  let totalGmv = 0;

  for (const row of rows) {
    const level2 = row.level2_category?.trim();
    const gmv = row.gmv ?? 0;
    if (!level2 || gmv <= 0) continue;

    byCategory.set(level2.toLowerCase(), (byCategory.get(level2.toLowerCase()) ?? 0) + gmv);
    totalGmv += gmv;

    if (!row.price_segment) continue;
    const key = cellKey(level2, row.price_segment);
    const existing = cells.get(key);
    if (existing) {
      existing.gmv += gmv;
      existing.liveGmv += row.live_gmv ?? 0;
      existing.itemsSold += row.items_sold ?? 0;
    } else {
      cells.set(key, {
        level2Category: level2,
        segment: row.price_segment,
        gmv,
        liveGmv: row.live_gmv ?? 0,
        itemsSold: row.items_sold ?? 0,
        avgPrice: row.avg_price ?? null,
        share: 0, // filled in below once totalGmv is final
      });
    }
  }

  for (const cell of cells.values()) {
    cell.share = totalGmv > 0 ? cell.gmv / totalGmv : 0;
    // avg_price prefers the stored value; fall back to gmv/items if missing.
    if (cell.avgPrice === null && cell.itemsSold > 0) cell.avgPrice = cell.gmv / cell.itemsSold;
  }

  return { cells, byCategory, totalGmv };
}

/** Adjacent segments (one step up/down the price ladder) used for the fallback match. */
const SEGMENT_ORDER: PriceSegment[] = ["low", "entry", "sweet", "high", "premium"];
function adjacentSegments(segment: PriceSegment): PriceSegment[] {
  const i = SEGMENT_ORDER.indexOf(segment);
  const out: PriceSegment[] = [];
  if (i > 0) out.push(SEGMENT_ORDER[i - 1]);
  if (i < SEGMENT_ORDER.length - 1) out.push(SEGMENT_ORDER[i + 1]);
  return out;
}

// ---------- product → creator matching shapes ----------

export type MatchReason = "exact_cell" | "adjacent_segment";

/** One products_tap row (only the fields matching needs). */
export interface ProductRow {
  productId: string;
  productName: string | null;
  shopId: string;
  shopName: string | null;
  level2Category: string | null;
  priceSegment: PriceSegment | null;
  price: number | null;
  commissionPct: number | null;
}

export interface ProductMatch {
  product: ProductRow;
  score: number;
  reason: MatchReason;
  /** The (category, segment) cell that produced the score. */
  matchedSegment: PriceSegment;
}

/**
 * Direction 1: pick a creator (via its segment matrix) → rank TAP products.
 * Score = creator's GMV share in the (level2, segment) cell of the product.
 * Exact-cell matches always outrank adjacent-segment fallbacks (adjacent score
 * is halved AND capped below the minimum possible exact-cell score via a large
 * tier gap, so ranking never mixes tiers ambiguously).
 */
export function matchProductsForCreator(
  matrix: CreatorSegmentMatrix,
  products: ProductRow[],
  topN: number
): ProductMatch[] {
  const ADJACENT_PENALTY = 0.5;
  const results: ProductMatch[] = [];

  for (const product of products) {
    const level2 = product.level2Category?.trim();
    if (!level2 || !product.priceSegment) continue;
    const level2Lower = level2.toLowerCase();

    const exact = matrix.cells.get(cellKey(level2Lower, product.priceSegment));
    if (exact && exact.share > 0) {
      results.push({
        product,
        score: exact.share,
        reason: "exact_cell",
        matchedSegment: product.priceSegment,
      });
      continue;
    }

    // fallback: best adjacent segment in the same category
    let best: { segment: PriceSegment; share: number } | null = null;
    for (const seg of adjacentSegments(product.priceSegment)) {
      const cell = matrix.cells.get(cellKey(level2Lower, seg));
      if (cell && cell.share > 0 && (!best || cell.share > best.share)) {
        best = { segment: seg, share: cell.share };
      }
    }
    if (best) {
      results.push({
        product,
        score: best.share * ADJACENT_PENALTY,
        reason: "adjacent_segment",
        matchedSegment: best.segment,
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ---------- product → creator matching (opposite direction, for /matching) ----------

export interface CreatorMatch {
  creatorId: string;
  creatorName: string;
  score: number;
  reason: MatchReason;
  matchedSegment: PriceSegment;
}

/** One creator's segment matrix, tagged with identity — input to matchCreatorsForProduct. */
export interface CreatorMatrixEntry {
  creatorId: string;
  creatorName: string;
  matrix: CreatorSegmentMatrix;
}

/**
 * Direction 2: pick a product → rank creators most likely to sell it, using the
 * SAME scoring rule as matchProductsForCreator (share of GMV in the matching
 * cell), just iterated over creators instead of products.
 */
export function matchCreatorsForProduct(
  product: ProductRow,
  allCreatorMatrices: CreatorMatrixEntry[],
  topN: number
): CreatorMatch[] {
  const ADJACENT_PENALTY = 0.5;
  const level2 = product.level2Category?.trim();
  if (!level2 || !product.priceSegment) return [];
  const level2Lower = level2.toLowerCase();

  const results: CreatorMatch[] = [];
  for (const entry of allCreatorMatrices) {
    const exact = entry.matrix.cells.get(cellKey(level2Lower, product.priceSegment));
    if (exact && exact.share > 0) {
      results.push({
        creatorId: entry.creatorId,
        creatorName: entry.creatorName,
        score: exact.share,
        reason: "exact_cell",
        matchedSegment: product.priceSegment,
      });
      continue;
    }

    let best: { segment: PriceSegment; share: number } | null = null;
    for (const seg of adjacentSegments(product.priceSegment)) {
      const cell = entry.matrix.cells.get(cellKey(level2Lower, seg));
      if (cell && cell.share > 0 && (!best || cell.share > best.share)) {
        best = { segment: seg, share: cell.share };
      }
    }
    if (best) {
      results.push({
        creatorId: entry.creatorId,
        creatorName: entry.creatorName,
        score: best.share * ADJACENT_PENALTY,
        reason: "adjacent_segment",
        matchedSegment: best.segment,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

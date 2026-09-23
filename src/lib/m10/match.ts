/**
 * Creator segment matrix — pure, deterministic (0 LLM). Compute a creator's
 * average sale price per Level 2 sub-category → derive the price segment(s)
 * the creator can actually sell in. Used by the "Matriks Kategori × Segmen
 * Harga" table on the creator detail page.
 *
 * Product↔creator matching itself now lives in `@/lib/product-match/engine`
 * (Creator Product Match, satu engine — CLAUDE.md #4); `matchProductsForCreator`/
 * `matchCreatorsForProduct` that used to live here were retired in favor of it.
 *
 * All inputs are already-fetched rows — no DB access here, so this is fully
 * unit-testable and reusable.
 */

import type { PriceSegment } from "@/lib/projection/gmv";

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

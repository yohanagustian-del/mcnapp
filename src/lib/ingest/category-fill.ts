import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelationError } from "@/lib/db/missing-migration";

/** Product ids per RPC call (POST body, not URL — large chunks are fine). */
const LOOKUP_CHUNK = 5000;

export interface CategoryFillResult {
  /** Rows that had no level2 category in the file. */
  rowsMissing: number;
  /** Of those, rows filled from the platform's own product data. */
  rowsFilled: number;
  /** Affiliate GMV of rows still without a category after the fill. */
  gmvStillMissing: number;
  /** Set when the lookup function is not deployed yet (migration 0090). */
  skipped: string | null;
}

/** The row fields the fill reads/writes (McnRow and TapRow both fit). */
export interface CategoryRow {
  productId: string;
  affiliateGmv: number;
  level2Category: string | null;
  level1Category?: string | null;
}

/**
 * Some TikTok custom-report exports (all of September 2026) carry no Level 1 /
 * Level 2 category columns. Without a category a row never reaches
 * creator_subcat_segment_gmv, so Creator Product Match / M6 lose that week.
 * Fill the missing categories per product_id from data the platform already has
 * (migration 0090 `product_category_lookup`: creator_top_products, then
 * products_tap). Only rows WITHOUT a category are touched; a category present in
 * the file always wins. Mutates the rows in place. Deterministic, 0 LLM.
 *
 * `rows` (MCN) are counted in the result; `alsoFill` (TAP) is filled from the same
 * lookup without being counted — TAP rows feed the derived products_tap catalog,
 * which would otherwise overwrite known categories with null.
 */
export async function fillMissingCategories(
  admin: SupabaseClient,
  rows: CategoryRow[],
  alsoFill: CategoryRow[] = []
): Promise<CategoryFillResult> {
  const missingIds = new Set<string>();
  let rowsMissing = 0;
  for (const r of rows) {
    if (!r.level2Category) {
      rowsMissing++;
      missingIds.add(r.productId);
    }
  }
  for (const r of alsoFill) if (!r.level2Category) missingIds.add(r.productId);
  const result: CategoryFillResult = { rowsMissing, rowsFilled: 0, gmvStillMissing: 0, skipped: null };
  if (missingIds.size === 0) return result;

  const byProduct = new Map<string, { level1: string | null; level2: string }>();
  const ids = [...missingIds];
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const { data, error } = await admin.rpc("product_category_lookup", { p_product_ids: ids.slice(i, i + LOOKUP_CHUNK) });
    if (error) {
      if (isMissingRelationError(error)) {
        result.skipped = "Kategori produk tidak bisa diisi otomatis: migrasi 0090 (product_category_lookup) belum di-apply.";
        break;
      }
      throw new Error(`Gagal membaca kategori produk: ${error.message}`);
    }
    for (const c of (data ?? []) as { product_id: string; level1_category: string | null; level2_category: string }[]) {
      byProduct.set(c.product_id, { level1: c.level1_category, level2: c.level2_category });
    }
  }

  for (const r of rows) {
    if (r.level2Category) continue;
    if (applyCategory(r, byProduct.get(r.productId))) result.rowsFilled++;
    else result.gmvStillMissing += r.affiliateGmv;
  }
  for (const r of alsoFill) if (!r.level2Category) applyCategory(r, byProduct.get(r.productId));
  return result;
}

function applyCategory(r: CategoryRow, c: { level1: string | null; level2: string } | undefined): boolean {
  if (!c) return false;
  r.level2Category = c.level2;
  if ("level1Category" in r && !r.level1Category) r.level1Category = c.level1;
  return true;
}

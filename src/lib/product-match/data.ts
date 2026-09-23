/**
 * Data access untuk Creator Product Match — dipanggil dari server (admin
 * client) karena products_tap punya RLS `pt_creator_deny` untuk akun kreator
 * dan px_catalog_items punya `pxci_creator_deny` yang sama.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { fetchWindowHistory, windowStart } from "@/lib/projection/project-gmv";
import type { PriceBounds } from "@/lib/projection/gmv";
import {
  categoryProfile,
  matchProducts,
  normalizePxProduct,
  normalizeTapProduct,
  type CreatorSubcatRow,
  type MatchableProduct,
  type ProductMatchResult,
  type ProductTapRow,
  type PxCatalogRow,
} from "./engine";

export interface ProductMatchConfig {
  bounds: PriceBounds;
  topN: number;
  windowDays: number;
}

export async function loadProductMatchConfig(): Promise<ProductMatchConfig> {
  const [bounds, topN, windowDays] = await Promise.all([
    getConfig<PriceBounds>("segments.price_bounds"),
    getConfig<number>("product_match.top_n"),
    getConfig<number>("projection.window_days"),
  ]);
  return { bounds, topN, windowDays };
}

/** Baris creator_subcat_segment_gmv kreator dalam window berjalan (projection.window_days). */
export async function loadCreatorProfileRows(
  creatorId: string,
  windowDays: number
): Promise<CreatorSubcatRow[]> {
  const rows = await fetchWindowHistory(windowStart(windowDays), creatorId);
  return rows.map((r) => ({ level2_category: r.level2_category, gmv: r.gmv, orders: r.orders ?? null }));
}

/** products_tap aktif + px_catalog_items aktif, dinormalisasi jadi MatchableProduct siap-cocok. */
export async function loadMatchableProducts(): Promise<MatchableProduct[]> {
  const admin = createAdminClient();

  const tapRows = await fetchAll<ProductTapRow>(
    admin,
    "products_tap",
    "product_id, product_name, level2_category, affiliate_gmv, orders, price, campaign_name, shop_name, commission_pct, product_link",
    (q) => q.eq("active", true)
  );
  const pxRows = await fetchAll<PxCatalogRow>(
    admin,
    "px_catalog_items",
    "platform_product_id, nama_produk, level2_category, price_segment, nama_toko, sudah_afiliasi",
    (q) => q.eq("active", true)
  );

  const tap = tapRows.map(normalizeTapProduct).filter((p): p is MatchableProduct => p !== null);
  const px = pxRows.map(normalizePxProduct).filter((p): p is MatchableProduct => p !== null);
  return [...tap, ...px];
}

/**
 * Orkestrasi penuh untuk satu kreator: config → profil kategori → produk siap-
 * cocok → hasil match. Dipakai apa adanya oleh /matching, /creators/[id], CM
 * Workspace, dan portal kreator (CLAUDE.md #4 — satu engine, satu jalur data).
 */
export async function buildCreatorProductMatch(creatorId: string): Promise<ProductMatchResult> {
  const config = await loadProductMatchConfig();
  const [rows, products] = await Promise.all([
    loadCreatorProfileRows(creatorId, config.windowDays),
    loadMatchableProducts(),
  ]);
  const profile = categoryProfile(rows, config.bounds);
  return matchProducts(profile, products, config.bounds, config.topN);
}

/**
 * Creator Product Match — satu engine (pure, deterministic, 0 LLM), port logika
 * HTML tim "Creator_Product_Match": per kategori Level-2 kreator, hitung AOV
 * (GMV/orders) dalam window → segmen harga → cocokkan produk TAP/PX dengan
 * kategori sama & AOV di segmen yang sama → urut orders desc → top N.
 *
 * Semua input sudah berupa baris ter-fetch (tidak ada akses DB di sini) —
 * lihat data.ts untuk pengambilan data. CLAUDE.md §A/#4: satu engine dipakai
 * apa adanya oleh /matching, /creators/[id], CM Workspace, dan portal kreator.
 */

import { priceSegmentOf, type PriceBounds, type PriceSegment } from "@/lib/projection/gmv";

// ---------- profil kreator ----------

/** Satu baris creator_subcat_segment_gmv dalam window (sudah difilter window_end). */
export interface CreatorSubcatRow {
  level2_category: string | null;
  gmv: number | null;
  orders: number | null;
}

export interface CategoryProfile {
  lvl2: string;
  gmv: number;
  orders: number;
  aov: number;
  segment: PriceSegment;
}

/**
 * Agregasi per kategori Level-2: jumlah gmv & orders lintas baris (bisa lebih
 * dari satu baris per kategori — beda upload_batch/price_segment sumber), lalu
 * AOV = total gmv / total orders. Kategori dengan total orders <= 0 dilewati
 * (persis HTML: `if (orders <= 0) continue`) karena AOV tidak terdefinisi.
 * Hasil diurutkan GMV desc.
 */
export function categoryProfile(rows: CreatorSubcatRow[], bounds: PriceBounds): CategoryProfile[] {
  const byLvl2 = new Map<string, { gmv: number; orders: number }>();
  for (const row of rows) {
    const lvl2 = row.level2_category?.trim();
    if (!lvl2) continue;
    const key = lvl2.toLowerCase();
    const acc = byLvl2.get(key) ?? { gmv: 0, orders: 0 };
    acc.gmv += row.gmv ?? 0;
    acc.orders += row.orders ?? 0;
    byLvl2.set(key, acc);
  }

  const profiles: CategoryProfile[] = [];
  for (const row of rows) {
    const lvl2 = row.level2_category?.trim();
    if (!lvl2) continue;
    const key = lvl2.toLowerCase();
    if (profiles.some((p) => p.lvl2.toLowerCase() === key)) continue;
    const acc = byLvl2.get(key)!;
    if (acc.orders <= 0) continue;
    const aov = acc.gmv / acc.orders;
    profiles.push({ lvl2, gmv: acc.gmv, orders: acc.orders, aov, segment: priceSegmentOf(aov, bounds) });
  }

  return profiles.sort((a, b) => b.gmv - a.gmv);
}

// ---------- produk yang bisa dicocokkan (TAP ∪ PX) ----------

export type ProductSource = "tap" | "px";

/** Satu produk siap-cocok, sudah dinormalisasi dari products_tap atau px_catalog_items. */
export interface MatchableProduct {
  source: ProductSource;
  productId: string;
  productName: string | null;
  level2Category: string;
  /** AOV (affiliate_gmv/orders) bila ada performa; fallback ke `price` bila belum. */
  aov: number | null;
  aovSource: "performance" | "price" | null;
  orders: number;
  campaignName: string | null;
  shopName: string | null;
  commissionPct: number | null;
  productLink: string | null;
  /** PX only: dipakai untuk urutan tampil (belum afiliasi diprioritaskan). */
  sudahAfiliasi: boolean | null;
}

/** Baris products_tap aktif (subset kolom yang relevan untuk matching). */
export interface ProductTapRow {
  product_id: string;
  product_name: string | null;
  level2_category: string | null;
  affiliate_gmv: number | null;
  orders: number | null;
  price: number | null;
  campaign_name: string | null;
  shop_name: string | null;
  commission_pct: number | null;
  product_link: string | null;
}

/** Baris px_catalog_items aktif. */
export interface PxCatalogRow {
  platform_product_id: string;
  nama_produk: string | null;
  level2_category: string | null;
  price_segment: PriceSegment | null;
  nama_toko: string | null;
  sudah_afiliasi: boolean;
}

export function normalizeTapProduct(row: ProductTapRow): MatchableProduct | null {
  const lvl2 = row.level2_category?.trim();
  if (!lvl2) return null;

  let aov: number | null = null;
  let aovSource: MatchableProduct["aovSource"] = null;
  if (row.orders && row.orders > 0 && row.affiliate_gmv != null) {
    aov = row.affiliate_gmv / row.orders;
    aovSource = "performance";
  } else if (row.price != null && row.price > 0) {
    aov = row.price;
    aovSource = "price";
  }
  if (aov == null) return null;

  return {
    source: "tap",
    productId: row.product_id,
    productName: row.product_name,
    level2Category: lvl2,
    aov,
    aovSource,
    orders: row.orders ?? 0,
    campaignName: row.campaign_name,
    shopName: row.shop_name,
    commissionPct: row.commission_pct,
    productLink: row.product_link,
    sudahAfiliasi: null,
  };
}

/**
 * PX tidak punya AOV/orders (D-06: angka volume berhenti di CDPS) — segmen
 * sudah dikirim CDPS sendiri (data taksonomi mereka, bukan dihitung ulang di
 * sini). `aov` null; pencocokan segmen pakai `pxSegmentMatches` di bawah.
 */
export function normalizePxProduct(row: PxCatalogRow): MatchableProduct | null {
  const lvl2 = row.level2_category?.trim();
  if (!lvl2) return null;
  return {
    source: "px",
    productId: row.platform_product_id,
    productName: row.nama_produk,
    level2Category: lvl2,
    aov: null,
    aovSource: null,
    orders: 0,
    campaignName: null,
    shopName: row.nama_toko,
    commissionPct: null,
    productLink: null,
    sudahAfiliasi: row.sudah_afiliasi,
  };
}

// ---------- pencocokan ----------

export interface MatchedProduct {
  source: ProductSource;
  productId: string;
  productName: string | null;
  aov: number | null;
  aovSource: MatchableProduct["aovSource"];
  orders: number;
  campaignName: string | null;
  shopName: string | null;
  commissionPct: number | null;
  productLink: string | null;
  sudahAfiliasi: boolean | null;
  /** Label tampil untuk sumber PX — CLAUDE.md rencana §A. */
  sourceLabel: string | null;
}

export interface CategoryMatch {
  lvl2: string;
  gmv: number;
  orders: number;
  aov: number;
  segment: PriceSegment;
  products: MatchedProduct[];
}

export interface ProductMatchSummary {
  totalGmv: number;
  totalOrders: number;
  categoryCount: number;
  segmentCounts: Partial<Record<PriceSegment, number>>;
}

export interface ProductMatchResult {
  categories: CategoryMatch[];
  summary: ProductMatchSummary;
}

const PX_SOURCE_LABEL = "Seller manage by MEA";

function sameCategory(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Untuk tiap kategori profil kreator, cocokkan produk TAP/PX dengan kategori
 * sama DAN berada di segmen harga yang sama (produk TAP: segmen dari AOV
 * produk lewat priceSegmentOf yang SAMA dengan kreator — bukan dihitung ulang
 * dengan rumus lain; produk PX: segmen sudah dikirim CDPS). Urut: TAP diurut
 * orders desc (persis HTML); PX diselipkan dengan sudah_afiliasi dulu lalu
 * nama, karena tidak punya orders. TAP & PX digabung, TAP tetap tampil
 * berdasar posisi orders sedangkan PX ditambahkan di akhir grup per kategori
 * (tidak mengganggu urutan orders desc TAP yang jadi acuan utama HTML).
 */
export function matchProducts(
  profile: CategoryProfile[],
  products: MatchableProduct[],
  bounds: PriceBounds,
  topN: number
): ProductMatchResult {
  const categories: CategoryMatch[] = profile.map((cat) => {
    const tapCandidates = products
      .filter((p) => p.source === "tap" && sameCategory(p.level2Category, cat.lvl2))
      .filter((p) => p.aov != null && priceSegmentOf(p.aov, bounds) === cat.segment)
      .sort((a, b) => b.orders - a.orders);

    const pxCandidates = products
      .filter((p) => p.source === "px" && sameCategory(p.level2Category, cat.lvl2))
      .sort((a, b) => {
        const afiliasiDiff = Number(b.sudahAfiliasi ?? false) - Number(a.sudahAfiliasi ?? false);
        if (afiliasiDiff !== 0) return afiliasiDiff;
        return (a.productName ?? "").localeCompare(b.productName ?? "");
      });

    const merged = [...tapCandidates, ...pxCandidates].slice(0, topN).map(
      (p): MatchedProduct => ({
        source: p.source,
        productId: p.productId,
        productName: p.productName,
        aov: p.aov,
        aovSource: p.aovSource,
        orders: p.orders,
        campaignName: p.campaignName,
        shopName: p.shopName,
        commissionPct: p.commissionPct,
        productLink: p.productLink,
        sudahAfiliasi: p.sudahAfiliasi,
        sourceLabel: p.source === "px" ? PX_SOURCE_LABEL : null,
      })
    );

    return { lvl2: cat.lvl2, gmv: cat.gmv, orders: cat.orders, aov: cat.aov, segment: cat.segment, products: merged };
  });

  const segmentCounts: Partial<Record<PriceSegment, number>> = {};
  for (const cat of profile) {
    segmentCounts[cat.segment] = (segmentCounts[cat.segment] ?? 0) + 1;
  }

  return {
    categories,
    summary: {
      totalGmv: profile.reduce((sum, c) => sum + c.gmv, 0),
      totalOrders: profile.reduce((sum, c) => sum + c.orders, 0),
      categoryCount: profile.length,
      segmentCounts,
    },
  };
}

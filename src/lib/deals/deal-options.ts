import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daftar pilihan Deal Brand di app_config (migrasi 0097, DECISIONS D-2026-10-20-2/3/7).
 * Default di sini = isi seed 0097, dipakai bila app_config belum punya kuncinya
 * (0097 belum di-apply) — app_config tetap sumber kebenaran begitu ada.
 */
export const DEFAULT_ADS_SUPPORT_OPTIONS = [
  "Brand Barcode Bulking - Cek BD",
  "Brand Invoice Bulking - Cek BD",
  "Brand Invoice One Time - Cek BD",
  "Ads By Brand - Minta Barcode",
  "Transfer Daily by Brand",
  "Tidak Support Ads",
];

export const DEFAULT_LEADS_TYPE_OPTIONS = [
  "Internal TAP", "Celebrity", "China", "Minishowcase", "Matchmaking",
  "Campaign Internal (A&S)", "Affiliate Academy", "Internal ABP", "Scouting",
];

export const DEFAULT_NICHE_OPTIONS = [
  "Automotive & Motorcycle", "Baby & Maternity", "Beauty & Personal Care",
  "Books, Magazines & Audio", "Computers & Office Equipment", "Fashion",
  "Fashion Accessories", "Food & Beverages", "Fragrance", "Furniture", "Health",
  "Home & Living", "Home Improvement", "Home Supplies", "Household Appliances",
  "Kids' Fashion", "Kitchenware", "Lifestyle", "Luggage & Bags",
  "Menswear & Underwear", "Mom & baby", "Muslim Fashion", "Personal care",
  "Pet Supplies", "Phones & Electronics", "Shoes", "Sports & Outdoor",
  "Textiles & Soft Furnishings", "Tools & Hardware", "Toys & Hobbies", "Women Bag",
  "Womenswear & Underwear",
];

/**
 * Variasi ejaan niche yang TIDAK digabung otomatis (DECISIONS D-2026-10-20-7) — hanya
 * diusulkan ke tim di laporan. Kunci = nilai sheet, nilai = kandidat gabungan.
 */
export const NICHE_MERGE_PROPOSALS: { from: string; to: string; note: string }[] = [
  { from: "Personal care", to: "Beauty & Personal Care", note: "ejaan/kategori induk TikTok" },
  { from: "Mom & baby", to: "Baby & Maternity", note: "kategori TikTok = Baby & Maternity" },
  { from: "Fashion", to: "Womenswear & Underwear / Menswear & Underwear / Muslim Fashion", note: "terlalu umum — pilih kategori TikTok" },
  { from: "Lifestyle", to: "Home & Living / Fashion Accessories", note: "bukan kategori TikTok" },
];

export interface DealOptions {
  adsSupport: string[];
  leadsType: string[];
  niche: string[];
  /** true = kunci app_config belum ada (0097 belum di-apply) → memakai default. */
  fromDefaults: boolean;
}

const asStringList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;

export async function loadDealOptions(client: SupabaseClient): Promise<DealOptions> {
  const { data } = await client
    .from("app_config")
    .select("key, value")
    .in("key", ["m8.ads_support_options", "m8.leads_type_options", "m8.niche_options"]);
  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));
  const ads = asStringList(map.get("m8.ads_support_options"));
  const leads = asStringList(map.get("m8.leads_type_options"));
  const niche = asStringList(map.get("m8.niche_options"));
  return {
    adsSupport: ads ?? DEFAULT_ADS_SUPPORT_OPTIONS,
    leadsType: leads ?? DEFAULT_LEADS_TYPE_OPTIONS,
    niche: niche ?? DEFAULT_NICHE_OPTIONS,
    fromDefaults: !ads || !leads || !niche,
  };
}

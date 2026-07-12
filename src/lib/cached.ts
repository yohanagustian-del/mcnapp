import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Helper cache untuk data SEMI-STATIS (bukan transaksional) — CLAUDE.md
 * "Batch D": kurangi round-trip DB dengan unstable_cache (revalidate 600s).
 *
 * Kenapa admin client, bukan createClient() dari @/lib/supabase/server:
 * callback unstable_cache TIDAK boleh memanggil cookies() (Next melempar
 * error runtime jika dipanggil dari dalam cache scope), dan client biasa
 * membaca cookies untuk sesi user. createAdminClient() (service-role) tidak
 * menyentuh cookies sama sekali. Ini aman karena data di bawah non-sensitif
 * & seragam untuk semua member internal (RLS-nya `select ... to
 * authenticated using (true)`) — nilai cache global lintas user tidak
 * membocorkan apa pun. Halaman pemakainya tetap digerbang
 * requireMember()/hasPermission() seperti biasa; cache hanya menghemat query,
 * bukan pengganti otorisasi.
 *
 * JANGAN pakai pola ini untuk data transaksional (deals, projects, metrics,
 * dll) — itu harus selalu baca langsung agar konsisten & auditable.
 */

// Kandidat filter kategori Level 2 di halaman /products (datalist). Sama
// persis dengan query `categoryRows`/`categories` yang sebelumnya inline di
// products/page.tsx (limit 1000, distinct, filter falsy, sort).
export const getCachedLevel2Categories = unstable_cache(
  async (): Promise<string[]> => {
    const supabase = createAdminClient();
    const { data: categoryRows } = await supabase
      .from("products_tap")
      .select("level2_category")
      .not("level2_category", "is", null)
      .limit(1000);
    return [...new Set((categoryRows ?? []).map((r) => r.level2_category).filter(Boolean))].sort();
  },
  ["products-level2-categories"],
  { revalidate: 600, tags: ["products_tap"] }
);

// Kandidat niche untuk datalist di /deals/baru: union distinct
// brand_deals.niche & products_tap.level2_category. Sama persis dengan
// query dealNicheRows/productNicheRows + perakitan nicheOptions yang
// sebelumnya inline di deals/baru/page.tsx.
export const getCachedNicheOptions = unstable_cache(
  async (): Promise<string[]> => {
    const supabase = createAdminClient();
    const [{ data: dealNicheRows }, { data: productNicheRows }] = await Promise.all([
      supabase.from("brand_deals").select("niche").not("niche", "is", null).limit(1000),
      supabase.from("products_tap").select("level2_category").not("level2_category", "is", null).limit(1000),
    ]);
    return [
      ...new Set(
        [
          ...(dealNicheRows ?? []).map((r) => r.niche),
          ...(productNicheRows ?? []).map((r) => r.level2_category),
        ].filter((v): v is string => Boolean(v && v.trim()))
      ),
    ].sort();
  },
  ["deals-niche-options"],
  { revalidate: 600, tags: ["brand_deals", "products_tap"] }
);

/**
 * Versi ter-cache dari getConfig() (src/lib/config.ts) — HANYA untuk jalur
 * baca-tampil (render halaman). Perilaku error disamakan persis dengan
 * getConfig asli: key tidak ada → throw Error dengan format pesan yang sama.
 * getConfig asli TIDAK diubah dan tetap dipakai di jalur tulis/engine/action
 * (ingest, m4, m5, m7 tracking, projection, m10 products, server actions)
 * supaya nilai config selalu fresh di sana.
 */
export async function getCachedConfig<T = number>(key: string): Promise<T> {
  const cachedRead = unstable_cache(
    async (): Promise<T> => {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", key)
        .single();
      if (error || data === null) {
        throw new Error(`app_config missing key "${key}": ${error?.message ?? "not found"}`);
      }
      return data.value as T;
    },
    ["app-config", key],
    { revalidate: 600, tags: ["app_config"] }
  );
  return cachedRead();
}

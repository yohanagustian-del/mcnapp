import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pencarian brand/shop untuk SEMUA pemilih shop di aplikasi — form Tambah/Edit
 * Project BD dan form slot Jadwal Live.
 *
 * KENAPA DI SERVER. Katalog shop sudah belasan ribu baris. Pemilih yang memuat
 * sepotong daftar sekali lalu menyaringnya di klien hanya bisa menemukan shop yang
 * kebetulan ikut termuat — sisanya TIDAK ADA sama sekali bagi pemakai, dan batas
 * berapa pun yang dipasang cuma menunda masalahnya karena katalognya bertambah tiap
 * ingest mingguan.
 *
 * KENAPA SATU MODUL. Filter dan urutannya harus sama dengan kotak cari tabel Shop di
 * tab Deal Brand (`/deals`): shop yang terlihat di sana harus bisa dipilih di mana
 * pun. Menyalin ekspresinya ke tiap pemilih berarti beberapa perilaku pencarian yang
 * bisa berbeda diam-diam (CLAUDE.md #4).
 */

/**
 * Batas baris yang ditampilkan pemilih brand/shop — sekali muat awal maupun sekali
 * pencarian. Sebesar yang masih enak dibaca dalam satu daftar bergulir; kalau
 * hasilnya kena batas, formnya MENGATAKANNYA alih-alih diam-diam memotong.
 */
export const SHOP_PICKER_LIMIT = 50;

/** Kolom minimum yang dibutuhkan setiap pemilih shop. */
export const SHOP_PICKER_COLUMNS = "shop_key, shop_name, shop_id, product_count";

export interface ShopSearchPage {
  rows: Record<string, unknown>[];
  /** true = hasilnya kena batas, jadi masih ada yang cocok tapi tidak ditampilkan. */
  capped: boolean;
}

/**
 * Membersihkan kata kunci dari karakter yang punya arti khusus di filter PostgREST
 * `or=(...)`: koma memisah kondisi dan tanda kurung membungkusnya, jadi nama shop
 * yang memuatnya bisa berubah jadi kondisi tambahan alih-alih dicari apa adanya.
 *
 * Dibuang, bukan di-escape: ini kotak cari, dan nama shop yang memuat karakter itu
 * tetap ketemu lewat sisa katanya.
 *
 * Kembalian: "" = kotak cari kosong (tampilkan daftar bawaan); null = ada yang
 * diketik tapi habis setelah dibersihkan, jadi hasilnya memang kosong — sengaja
 * dibedakan supaya ketikan "(((" tidak malah menampilkan daftar bawaan seolah itu
 * hasil pencariannya.
 */
export function sanitizeShopSearchTerm(raw: string): string | null {
  const term = raw.trim();
  if (!term) return "";
  const safe = term.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  return safe === "" ? null : safe;
}

/**
 * Cari shop di view `deal_shop_summary`.
 *
 * Sumbernya view yang sama dengan tabel Shop di tab Deal Brand, jadi hasilnya
 * termasuk shop yang deal-nya sudah terdaftar tapi kartu produknya belum turun
 * (Registrasi Deal berisi Shop Name saja) — shop seperti itu tidak ada di
 * `products_tap` dan akan hilang kalau pencariannya menembak tabel itu langsung.
 *
 * `columns` bisa diperluas pemanggil (mis. `pic_tap_ids` untuk form Jadwal Live);
 * pemetaan barisnya jadi tanggung jawab pemanggil karena tiap pemilih punya bentuk
 * pilihannya sendiri.
 */
export async function searchShopSummary(
  supabase: SupabaseClient,
  {
    term,
    columns = SHOP_PICKER_COLUMNS,
    limit = SHOP_PICKER_LIMIT,
  }: { term: string; columns?: string; limit?: number }
): Promise<ShopSearchPage> {
  const cleaned = sanitizeShopSearchTerm(term);
  if (cleaned === null) return { rows: [], capped: false };

  let query = supabase
    .from("deal_shop_summary")
    .select(columns)
    // Urutan bawaan sama dengan tabel Shop di tab Deal Brand: kartu terbanyak dulu,
    // lalu shop yang punya baris deal (0 kartu). Tanpa pengurutan kedua, semua shop
    // yang baru didaftarkan menumpuk di ekor dan jadi yang pertama terpotong batas —
    // persis baris yang paling butuh dilihat setelah didaftarkan.
    .order("product_count", { ascending: false })
    .order("deal_count", { ascending: false })
    .order("shop_key", { ascending: true })
    // +1 baris cuma untuk MENGETAHUI masih ada sisa; baris ekstranya dibuang di bawah.
    .limit(limit + 1);

  if (cleaned) {
    const pattern = `%${cleaned}%`;
    // shop_key sudah berisi Shop Name (atau "#shop_id" untuk baris tanpa nama), jadi
    // tiga filter ini cukup — sama dengan `/deals`.
    query = query.or(
      `shop_key.ilike.${pattern},shop_name.ilike.${pattern},shop_id.ilike.${pattern}`
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Gagal mencari shop: ${error.message}`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return { rows: rows.slice(0, limit), capped: rows.length > limit };
}

/** numeric/bigint hasil agregasi bisa datang sebagai string tergantung driver. */
export function shopNumeric(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

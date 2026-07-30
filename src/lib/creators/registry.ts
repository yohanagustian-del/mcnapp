import type { SupabaseClient } from "@supabase/supabase-js";
import { genId } from "@/lib/utils/id";

/**
 * Satu sumber kebenaran untuk MEMBACA & MEMBUAT baris master `creators`
 * (CLAUDE.md #4). Dibuat setelah insiden duplikat 2026-07-30.
 *
 * AKAR MASALAH yang dicegah modul ini: kode lama mencari kreator existing dengan
 * `admin.from("creators").select("id, name, username").limit(5000)` lalu
 * mencocokkan di JS. PostgREST memotong SETIAP response di `db-max-rows`
 * (default Supabase = 1.000 baris) — `.limit(5000)` tidak menaikkan batas itu,
 * response tetap 1.000 baris TANPA error. Akibatnya setiap kreator di luar 1.000
 * baris pertama terlihat "belum ada" dan dibuat lagi pada tiap upload: 3.269 baris
 * untuk 1.140 username unik, satu username sampai 18 baris. Duplikat memang mulai
 * muncul persis ketika tabel melewati 1.000 baris.
 *
 * Aturannya sekarang: JANGAN pernah membaca master kreator dengan satu
 * `.select().limit(n)`. Pakai `fetchAllCreatorIdentities()` (berpaginasi) atau
 * filter di server (`.eq`/`.ilike`/`.in`) yang hasilnya pasti < 1.000 baris.
 */

/** Ukuran halaman = batas keras PostgREST. Halaman penuh ⇒ mungkin masih ada lagi. */
export const CREATOR_PAGE_SIZE = 1000;
/** Rem darurat: 100 halaman = 100.000 kreator, jauh di atas skala nyata (± 1.100). */
export const MAX_CREATOR_PAGES = 100;

export interface CreatorIdentity {
  id: string;
  name: string | null;
  username: string | null;
  platform: string | null;
}

/**
 * Membaca SELURUH identitas kreator dengan paginasi `.range()` — bukan satu
 * `.limit(besar)` yang diam-diam terpotong di 1.000 baris (lihat doc modul).
 * Diurutkan by id supaya paginasinya stabil (tanpa ORDER BY, urutan baris
 * antar-halaman tidak dijamin dan baris bisa terlewat/ganda).
 */
export async function fetchAllCreatorIdentities(
  admin: SupabaseClient
): Promise<CreatorIdentity[]> {
  return fetchAllCreatorRows<CreatorIdentity>(admin, "id, name, username, platform");
}

/**
 * Versi generik: baca SELURUH baris `creators` untuk kolom apa pun, berpaginasi.
 * Dipakai jalur yang butuh kolom di luar identitas (mis. import sheet yang juga
 * membaca owner_cpm_id). Tetap satu tempat supaya tidak ada `.limit(besar)` baru
 * yang kena potong 1.000 baris.
 */
export async function fetchAllCreatorRows<T>(
  admin: SupabaseClient,
  columns: string
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_CREATOR_PAGES; page++) {
    const from = page * CREATOR_PAGE_SIZE;
    const { data, error } = await admin
      .from("creators")
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + CREATOR_PAGE_SIZE - 1);
    if (error) throw new Error(`Gagal membaca master kreator: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    // Halaman tidak penuh = halaman terakhir.
    if (rows.length < CREATOR_PAGE_SIZE) return out;
  }
  throw new Error(
    `Master kreator melebihi ${MAX_CREATOR_PAGES * CREATOR_PAGE_SIZE} baris — naikkan MAX_CREATOR_PAGES di src/lib/creators/registry.ts.`
  );
}

/**
 * Peta pencarian dari identitas kreator: username DAN display name (keduanya
 * lowercase) → creators.id. Export platform memakai username, template lama
 * memakai display name — keduanya dicocokkan, seperti perilaku sebelumnya.
 *
 * `platform` opsional untuk menyempitkan ke satu platform saja (ingest Shopee,
 * CLAUDE.md #5: username Shopee TIDAK boleh cocok ke baris TikTok).
 */
export function buildCreatorLookup(
  rows: CreatorIdentity[],
  platform?: "tiktok" | "shopee"
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const c of rows) {
    if (platform && c.platform !== platform) continue;
    // username didahulukan: kalau display name satu kreator sama dengan username
    // kreator lain, username yang menang (identitas platform).
    if (c.name) lookup.set(String(c.name).trim().toLowerCase(), c.id);
  }
  for (const c of rows) {
    if (platform && c.platform !== platform) continue;
    if (c.username) lookup.set(String(c.username).trim().toLowerCase(), c.id);
  }
  return lookup;
}

/**
 * Insert satu baris kreator dengan id `CRT-` hasil generate, retry pada tabrakan
 * id yang langka. SATU implementasi untuk semua jalur yang berhak membuat kreator
 * (form registrasi akuisisi, bulk upload master, approve daftar tunggu) — jalur
 * upload data mingguan TIDAK boleh memakainya (migration 0028).
 *
 * @returns id kreator baru.
 * @throws Error kalau gagal (termasuk pelanggaran unique username dari 0029 —
 *   pesannya diteruskan apa adanya supaya pemanggil bisa menampilkannya).
 */
export async function insertCreatorWithGeneratedId(
  admin: SupabaseClient,
  payload: Record<string, unknown>,
  attempts = 3
): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const id = genId("CRT");
    const { error } = await admin.from("creators").insert({ id, ...payload });
    if (!error) return id;
    lastError = error.message;
    // 23505 = unique_violation. Bisa dari tabrakan id (aman untuk dicoba ulang)
    // ATAU dari unique username 0029 (percobaan ulang tidak akan menolong).
    const isUsernameClash = error.code === "23505" && /username/i.test(error.message);
    if (error.code !== "23505" || isUsernameClash) break;
  }
  throw new Error(lastError || "Gagal membuat kreator (alasan tidak diketahui)");
}

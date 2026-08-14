/**
 * Sentinel campaign untuk baris tanpa campaign (derive ingest mingguan).
 * campaign_id ikut jadi primary key (0040) sehingga tidak boleh null.
 *
 * Tinggal di sini, bukan di `products.ts`: modul ini dipakai komponen KLIEN
 * (checkbox tabel), dan products.ts menyeret rbac → supabase/server (next/headers)
 * yang tidak boleh ikut ke bundel browser. products.ts me-re-export nilai ini.
 */
export const NO_CAMPAIGN = "-";

/**
 * Kunci baris katalog Produk TAP = (campaign_id, product_id) — primary key sejak
 * migrasi 0040. Dipakai bersama oleh tabel (checkbox terpilih) dan server action
 * bulk edit/hapus, jadi aturan encode/decode-nya ditaruh di satu tempat.
 *
 * Formatnya JSON `["campaign","product"]`, BUKAN gabungan berpemisah: campaign id
 * hasil registrasi bisa berupa teks bebas ("DEAL-XK3M9", "-"), dan pemisah karakter
 * apa pun cepat atau lambat akan muncul di dalam nilainya sendiri — JSON tidak
 * pernah ambigu dan bisa dibalik lagi tanpa tebakan.
 */

/** Batas satu operasi bulk. Cukup untuk kerja harian, dan menjaga payload audit tetap wajar. */
export const BULK_LIMIT = 200;

export interface ProductKey {
  campaignId: string;
  productId: string;
}

export function productRowKey(campaignId: string | null, productId: string): string {
  return JSON.stringify([campaignId || NO_CAMPAIGN, productId]);
}

/**
 * Membaca daftar kunci yang dikirim form bulk: JSON array berisi hasil
 * productRowKey(). Kunci rusak/duplikat DIBUANG, bukan diam-diam dianggap baris
 * lain — operasi bulk tidak boleh menyasar baris yang tidak dipilih.
 */
export function parseProductRowKeys(raw: string): ProductKey[] {
  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch {
    throw new Error("Daftar produk terpilih tidak terbaca");
  }
  if (!Array.isArray(outer)) throw new Error("Daftar produk terpilih tidak terbaca");

  const seen = new Set<string>();
  const keys: ProductKey[] = [];
  for (const entry of outer) {
    if (typeof entry !== "string" || seen.has(entry)) continue;
    let pair: unknown;
    try {
      pair = JSON.parse(entry);
    } catch {
      continue;
    }
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [campaignId, productId] = pair;
    if (typeof campaignId !== "string" || typeof productId !== "string") continue;
    if (!campaignId || !productId) continue;
    seen.add(entry);
    keys.push({ campaignId, productId });
  }
  return keys;
}

/**
 * Kunci dikelompokkan per campaign supaya bulk update/delete cukup satu query per
 * campaign (`campaign_id = c and product_id in (...)`) — bukan satu round-trip per
 * baris. PostgREST tidak punya filter tuple `(a,b) in (...)`.
 */
export function groupKeysByCampaign(keys: ProductKey[]): Map<string, string[]> {
  const byCampaign = new Map<string, string[]>();
  for (const k of keys) {
    const list = byCampaign.get(k.campaignId) ?? [];
    list.push(k.productId);
    byCampaign.set(k.campaignId, list);
  }
  return byCampaign;
}

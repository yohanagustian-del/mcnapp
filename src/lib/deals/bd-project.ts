import { z } from "zod";

/**
 * Aturan form "Tambah Project" / "Edit Project" pada tab Project BD.
 *
 * Satu project = nama bebas + daftar shop yang digarap. Shop-nya dipilih dari
 * tabel "Shop dari Produk TAP" (tab Deal Brand), yang isinya sudah dikelompokkan
 * SQL lewat `products_tap.shop_key` — jadi yang disimpan project adalah kunci itu,
 * bukan salinan nama/ID shop. Angka project (kartu produk, ads budget, GMV) tidak
 * pernah disimpan ulang: detail project MEMBACA sumbernya (CLAUDE.md #4).
 *
 * Dipisah dari server action supaya bisa diuji tanpa Next/Supabase dan dipakai
 * bersama form klien & validasi server — satu aturan, bukan dua salinan.
 */

/**
 * Batas shop per project. Bukan batas teknis: project dengan ratusan shop hampir
 * pasti salah pilih (mis. "pilih semua" tak sengaja), dan detailnya jadi tak
 * terbaca. Angka yang wajar untuk campaign multi-brand terbesar sekalipun.
 */
export const PROJECT_SHOP_LIMIT = 100;

/**
 * Batas kartu produk yang bisa ditandai "dikerjasamakan" dalam satu project.
 * Alasannya sama dengan batas shop: sekali simpan menulis seluruh daftar, dan
 * project dengan ribuan kartu terpilih hampir pasti hasil salah klik "pilih semua".
 * Selaras dengan batas 500 kartu yang dibaca halaman detail.
 */
export const PROJECT_PRODUCT_LIMIT = 500;

export const PROJECT_STATUSES = [
  { value: "running", label: "Running" },
  { value: "hold", label: "Hold" },
  { value: "done", label: "Done" },
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"];

export const PROJECT_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_STATUSES.map((s) => [s.value, s.label])
);

export const bdProjectSchema = z.object({
  /** Kosong saat menambah; terisi saat mengedit project yang sudah ada. */
  project_id: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().min(1).optional()
  ),
  name: z.string().trim().min(1, "Nama project wajib diisi").max(120, "Nama project terlalu panjang"),
  status: z.enum(["running", "hold", "done"]).default("running"),
  notes: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().optional()
  ),
});

export type BdProjectInput = z.infer<typeof bdProjectSchema>;

/**
 * Daftar shop yang dicentang di form, dikirim sebagai JSON array of shop_key.
 *
 * JSON, BUKAN gabungan berpemisah: shop_key adalah Shop Name apa adanya dan bisa
 * memuat koma, titik koma, atau pipa — pemisah karakter apa pun cepat atau lambat
 * muncul di dalam nilainya sendiri (alasan yang sama dengan kunci baris Produk TAP).
 *
 * Nilai rusak/duplikat DIBUANG, bukan diam-diam dianggap shop lain.
 */
export function parseShopKeys(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Daftar shop terpilih tidak terbaca");
  }
  if (!Array.isArray(parsed)) throw new Error("Daftar shop terpilih tidak terbaca");

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const key = entry.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** Ringkasan satu shop untuk agregat project — bentuknya subset baris view. */
export interface ProjectShopMetrics {
  product_count: number;
  active_count: number;
  needs_review_count: number;
  campaign_count: number;
  ads_budget: number | null;
  service_fee: number | null;
  gmv_tap: number | null;
  effective_start: string | null;
  effective_end: string | null;
}

export interface ProjectTotals {
  shop_count: number;
  product_count: number;
  active_count: number;
  needs_review_count: number;
  campaign_count: number;
  ads_budget: number | null;
  service_fee: number | null;
  gmv_tap: number | null;
  effective_start: string | null;
  effective_end: string | null;
}

/**
 * Total project = penjumlahan baris ringkasan shop yang SUDAH diagregasi SQL.
 *
 * Yang dijumlah di sini paling banyak sepuluhan baris (batas shop per project),
 * jadi ini membaca hasil agregasi — bukan memindahkan pipeline agregasi ke
 * JavaScript. Nominal dijumlah, masa berlaku diambil rentang gabungannya, dan
 * null tetap null (bukan 0) supaya "belum ada data" tidak tersamar jadi "nol".
 */
export function sumProjectShops(shops: ProjectShopMetrics[]): ProjectTotals {
  const add = (a: number | null, b: number | null): number | null => {
    if (a === null) return b;
    if (b === null) return a;
    return a + b;
  };

  const totals: ProjectTotals = {
    shop_count: shops.length,
    product_count: 0,
    active_count: 0,
    needs_review_count: 0,
    campaign_count: 0,
    ads_budget: null,
    service_fee: null,
    gmv_tap: null,
    effective_start: null,
    effective_end: null,
  };

  for (const s of shops) {
    totals.product_count += s.product_count;
    totals.active_count += s.active_count;
    totals.needs_review_count += s.needs_review_count;
    totals.campaign_count += s.campaign_count;
    totals.ads_budget = add(totals.ads_budget, s.ads_budget);
    totals.service_fee = add(totals.service_fee, s.service_fee);
    totals.gmv_tap = add(totals.gmv_tap, s.gmv_tap);
    // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
    if (s.effective_start && (!totals.effective_start || s.effective_start < totals.effective_start)) {
      totals.effective_start = s.effective_start;
    }
    if (s.effective_end && (!totals.effective_end || s.effective_end > totals.effective_end)) {
      totals.effective_end = s.effective_end;
    }
  }

  return totals;
}

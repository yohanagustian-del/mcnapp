import { z } from "zod";
import {
  CAMPAIGN_TYPE_NEEDS_BUDGET,
  CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL,
  CAMPAIGN_TYPE_VALUES,
} from "@/lib/deals/campaign-type";

/**
 * Aturan form "Registrasi Deal" (kartu produk) — dipisah dari server action supaya
 * bisa diuji tanpa Next/Supabase, dan supaya form klien & validasi server memakai
 * SATU daftar tipe campaign yang sama (CLAUDE.md #4).
 *
 * Pertanyaan formnya = header tabel Produk TAP (export TAP "Export link") + dimensi
 * komersial yang tidak ada di export platform (tipe campaign, ads budget, service
 * fee, deal by, PIC TAP). Hanya Product Name yang wajib — sisanya sering belum
 * diketahui saat deal baru ditutup, dan memaksa mengisinya justru memancing isian
 * karangan (masalah yang sama dengan master deal lama, CLAUDE.md #6).
 */

/** Teks kosong dari input yang tidak diisi → undefined (bukan 0 / string kosong). */
function blankToUndefined(v: unknown) {
  return typeof v === "string" && v.trim() === "" ? undefined : v;
}

/** Angka opsional; "" tidak boleh jadi 0, karena 0 adalah nilai yang sah. */
function optionalNumber(max?: number) {
  return z.preprocess(
    blankToUndefined,
    (max === undefined ? z.coerce.number().nonnegative() : z.coerce.number().min(0).max(max)).optional()
  );
}

/** Teks opsional yang dirapikan; "" → undefined. */
const optionalText = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());

/** Tanggal dari date picker (yyyy-mm-dd); kosong → undefined. */
const optionalDate = z.preprocess(
  blankToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal wajib dari date picker").optional()
);

export const productCardSchema = z.object({
  campaign_id: optionalText,
  // Satu-satunya isian wajib: tanpa nama produk kartunya tidak berarti apa-apa.
  product_name: z.string().trim().min(1, "Product Name wajib diisi"),
  product_id: z.preprocess(
    blankToUndefined,
    z.string().trim().regex(/^\d+$/, "Product ID harus angka").optional()
  ),
  price: optionalNumber(),
  shop_name: optionalText,
  shop_id: z.preprocess(
    blankToUndefined,
    z.string().trim().regex(/^\d+$/, "Shop ID harus angka").optional()
  ),
  effective_start: optionalDate,
  effective_end: optionalDate,
  commission_pct: optionalNumber(100),
  partner_commission_pct: optionalNumber(100),
  creator_shop_ads_commission_pct: optionalNumber(100),
  partner_shop_ads_commission_pct: optionalNumber(100),
  product_link: z.preprocess(blankToUndefined, z.string().url("Product Link harus URL").optional()),
  campaign_type: z.preprocess(blankToUndefined, z.enum(CAMPAIGN_TYPE_VALUES).optional()),
  ads_budget: optionalNumber(),
  service_fee: optionalNumber(),
  deal_by: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  pic_tap: z.preprocess(blankToUndefined, z.string().uuid().optional()),
});

export type ProductCardInput = z.infer<typeof productCardSchema>;

/**
 * Aturan yang tidak bisa dinyatakan per-field: Ads Budget & Service Fee wajib
 * HANYA saat tipe campaign = Paid Campaign. Dikembalikan sebagai peta fieldErrors
 * supaya pesannya menempel di input yang bersangkutan.
 *
 * Dipakai dua jalur tulis kartu produk: registrasi (registerDealCard) dan form Edit
 * di tab Produk TAP (updateProduct) — aturannya satu, bukan disalin per form.
 */
export function productCardIssues(d: {
  campaign_type?: string;
  ads_budget?: number;
  service_fee?: number;
  effective_start?: string;
  effective_end?: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};

  if (d.campaign_type === CAMPAIGN_TYPE_NEEDS_BUDGET) {
    const wajib = `Wajib diisi untuk ${CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL}`;
    if (d.ads_budget === undefined) errors.ads_budget = wajib;
    if (d.service_fee === undefined) errors.service_fee = wajib;
  }

  // Masa berlaku terbalik hampir selalu salah ketik, dan diam-diam merusak alert
  // kadaluarsa yang membaca effective_end.
  if (d.effective_start && d.effective_end && d.effective_end < d.effective_start) {
    errors.effective_end = "Tanggal selesai harus ≥ tanggal mulai";
  }

  return errors;
}

import { z } from "zod";

/**
 * Aturan form "Registrasi Deal" — dipisah dari server action supaya bisa diuji tanpa
 * Next/Supabase dan dipakai bersama form klien & validasi server (CLAUDE.md #4).
 *
 * Pertanyaan formnya = header tabel Produk TAP (export TAP "Export link") + dua
 * dimensi yang tidak ada di export platform (Deal by, PIC TAP). Tipe Campaign, Ads
 * Budget, dan Service Fee TIDAK lagi ditanyakan di sini: kedua nominal itu milik
 * pasangan (project, shop) dan diisi di tab Project BD, jadi menanyakannya saat
 * registrasi cuma memancing angka yang nanti bertabrakan.
 *
 * SEMUA pertanyaan opsional — termasuk Product Name — karena saat deal baru ditutup
 * sebagian besar kolom belum diketahui, dan memaksa mengisinya justru memancing isian
 * karangan (masalah yang sama dengan master deal lama, CLAUDE.md #6).
 *
 * Yang tetap dijaga ketat = FORMAT isian yang diisi (ID numerik, tanggal dari date
 * picker, komisi 0–100), plus larangan menyimpan form yang benar-benar kosong
 * (`isEmptyProductCard`) — submit tanpa satu pun isian tidak menambah informasi apa pun.
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
  // Opsional seperti kolom lain: nama produk sering baru turun belakangan (kartu
  // didaftarkan dari Product ID/link lebih dulu) dan bisa dilengkapi lewat Edit di
  // tab Produk TAP. Kartu tanpa nama ditandai perlu review oleh pemanggilnya.
  product_name: optionalText,
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
  deal_by: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  pic_tap: z.preprocess(blankToUndefined, z.string().uuid().optional()),
});

export type ProductCardInput = z.infer<typeof productCardSchema>;

/**
 * Semua pertanyaan opsional berarti form kosong pun lolos validasi per-field. Submit
 * seperti itu hanya menghasilkan baris ber-ID internal tanpa satu pun informasi —
 * sampah yang tidak bisa dicocokkan maupun diperbaiki. Ditolak di sini, bukan dengan
 * mewajibkan salah satu kolom tertentu.
 */
export function isEmptyProductCard(d: ProductCardInput): boolean {
  return Object.values(d).every((v) => v === undefined);
}

/**
 * Satu-satunya isian FORM yang bisa dinyatakan hanya dengan melihat dua kolom
 * sekaligus: masa berlaku tidak boleh terbalik. Dikembalikan sebagai peta fieldErrors
 * supaya pesannya menempel di input yang bersangkutan.
 *
 * Dipakai dua jalur tulis kartu produk: registrasi (registerDealCard) dan form Edit
 * di tab Produk TAP (updateProduct) — aturannya satu, bukan disalin per form.
 */
export function productCardIssues(d: {
  effective_start?: string;
  effective_end?: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};

  // Masa berlaku terbalik hampir selalu salah ketik, dan diam-diam merusak alert
  // kadaluarsa yang membaca effective_end.
  if (d.effective_start && d.effective_end && d.effective_end < d.effective_start) {
    errors.effective_end = "Tanggal selesai harus ≥ tanggal mulai";
  }

  return errors;
}

/**
 * Satu submit Registrasi Deal bisa berakhir di dua tempat, dan yang menentukan adalah
 * ADA/TIDAKNYA identitas produk:
 *
 *  - Ada Product Name atau Product ID → kartu produk di `products_tap` (tab Produk TAP).
 *  - Tidak ada keduanya, tapi Shop Name / Shop ID terisi → deal shop di `brand_deals`
 *    (tab Deal Brand). Kartu produknya belum bisa dibuat: tanpa nama maupun ID, baris
 *    di katalog Produk TAP tidak bisa dikenali orang maupun dicocokkan ke data TAP
 *    mingguan. Deal-nya sendiri sudah nyata, jadi ia tetap dicatat sebagai shop.
 *  - Tidak ada identitas produk MAUPUN shop → tidak ada yang bisa disimpan.
 *
 * Dipisah ke fungsi sendiri supaya keputusan percabangannya bisa diuji langsung.
 */
export type ProductCardTarget = "product_card" | "brand_deal" | "unidentified";

export function productCardTarget(d: {
  product_name?: string;
  product_id?: string;
  shop_name?: string;
  shop_id?: string;
}): ProductCardTarget {
  if (d.product_name !== undefined || d.product_id !== undefined) return "product_card";
  if (d.shop_name !== undefined || d.shop_id !== undefined) return "brand_deal";
  return "unidentified";
}

/** Nama kolom → label yang dipakai UI, supaya pesan error memakai istilah form. */
export const PRODUCT_CARD_FIELD_LABEL: Record<string, string> = {
  effective_end: "Product Effective End Time",
};

/** Peta fieldErrors → satu kalimat berlabel, untuk jalur yang tidak punya form per-field. */
export function productCardIssueMessage(issues: Record<string, string>): string {
  return Object.entries(issues)
    .map(([field, message]) => `${PRODUCT_CARD_FIELD_LABEL[field] ?? field}: ${message}`)
    .join("; ");
}

/**
 * Jawaban SEKALI-UNTUK-SEFILE pada upload massal kartu produk ("Upload Produk Deal
 * Lama via Excel" di halaman Registrasi Deal).
 *
 * File export TAP tidak membawa Deal by maupun PIC TAP — keduanya dimensi MEA, bukan
 * data platform. Karena satu file upload = satu deal, keduanya cukup ditanyakan sekali
 * lalu diisikan ke setiap kartu di file itu.
 *
 * Keduanya OPSIONAL: tidak dijawab → kolomnya tidak disentuh sama sekali, bukan
 * dikosongkan pada kartu yang sudah terisi. (Kolom "Nama BD" tidak ditanyakan: ia =
 * akun yang meng-upload, diisi importer dari sesi login — menanyakannya justru membuka
 * pintu salah tulis pemilik data.)
 *
 * Tipe Campaign, Ads Budget, dan Service Fee tidak lagi ada di sini: nominalnya milik
 * pasangan (project, shop) di tab Project BD, jadi upload deal tidak lagi menyentuh
 * ketiga kolom itu.
 */
export const uploadCampaignSchema = z.object({
  deal_by: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  pic_tap: z.preprocess(blankToUndefined, z.string().uuid().optional()),
});

export interface CampaignDefaults {
  deal_by?: string;
  pic_tap?: string;
}

/**
 * Membaca & memvalidasi jawaban per-file dari FormData upload.
 *
 * Mengembalikan pesan (bukan melempar) karena pemanggilnya adalah importer yang
 * melaporkan kegagalan lewat `UploadReport.error` — throw dari server action sudah
 * disensor Next.js di production sehingga pesannya tidak sampai ke user.
 *
 * Tanpa jawaban apa pun, `defaults` kosong dan importer tidak menyentuh kolomnya —
 * itulah perilaku "Upload Master Product List" di tab Produk TAP, yang memang tidak
 * menanyakannya.
 */
export function campaignDefaultsFromForm(raw: {
  deal_by?: unknown;
  pic_tap?: unknown;
}): { defaults: CampaignDefaults; error?: string } {
  const parsed = uploadCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      defaults: {},
      error: productCardIssueMessage(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]))
      ),
    };
  }
  return { defaults: parsed.data };
}

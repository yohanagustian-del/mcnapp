import { z } from "zod";
import {
  CAMPAIGN_TYPE_NEEDS_BUDGET,
  CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL,
  CAMPAIGN_TYPE_VALUES,
  type CampaignType,
} from "@/lib/deals/campaign-type";

/**
 * Aturan form "Registrasi Deal" (kartu produk) — dipisah dari server action supaya
 * bisa diuji tanpa Next/Supabase, dan supaya form klien & validasi server memakai
 * SATU daftar tipe campaign yang sama (CLAUDE.md #4).
 *
 * Pertanyaan formnya = header tabel Produk TAP (export TAP "Export link") + dimensi
 * komersial yang tidak ada di export platform (tipe campaign, ads budget, service
 * fee, deal by, PIC TAP). SEMUA pertanyaan opsional — termasuk Product Name — karena
 * saat deal baru ditutup sebagian besar kolom belum diketahui, dan memaksa mengisinya
 * justru memancing isian karangan (masalah yang sama dengan master deal lama,
 * CLAUDE.md #6). Satu-satunya aturan "wajib" yang tersisa bersifat kondisional: Ads
 * Budget & Service Fee saat tipe campaign = Paid Campaign.
 *
 * Yang tetap dijaga ketat = FORMAT isian yang diisi (ID numerik, tanggal dari date
 * picker, komisi 0–100), plus larangan menyimpan kartu yang benar-benar kosong
 * (`isEmptyProductCard`) — kartu tanpa satu pun isian tidak menambah informasi apa pun.
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
  campaign_type: z.preprocess(blankToUndefined, z.enum(CAMPAIGN_TYPE_VALUES).optional()),
  ads_budget: optionalNumber(),
  service_fee: optionalNumber(),
  deal_by: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  pic_tap: z.preprocess(blankToUndefined, z.string().uuid().optional()),
});

export type ProductCardInput = z.infer<typeof productCardSchema>;

/**
 * Semua pertanyaan opsional berarti form kosong pun lolos validasi per-field. Kartu
 * seperti itu hanya menghasilkan baris ber-ID internal tanpa satu pun informasi —
 * sampah yang tidak bisa dicocokkan maupun diperbaiki. Ditolak di sini, bukan dengan
 * mewajibkan salah satu kolom tertentu.
 */
export function isEmptyProductCard(d: ProductCardInput): boolean {
  return Object.values(d).every((v) => v === undefined);
}

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

/** Nama kolom → label yang dipakai UI, supaya pesan error memakai istilah form. */
export const PRODUCT_CARD_FIELD_LABEL: Record<string, string> = {
  campaign_type: "Tipe Campaign",
  ads_budget: "Ads Budget",
  service_fee: "Service Fee",
  effective_end: "Product Effective End Time",
};

/** Peta fieldErrors → satu kalimat berlabel, untuk jalur yang tidak punya form per-field. */
export function productCardIssueMessage(issues: Record<string, string>): string {
  return Object.entries(issues)
    .map(([field, message]) => `${PRODUCT_CARD_FIELD_LABEL[field] ?? field}: ${message}`)
    .join("; ");
}

/**
 * Jawaban Tipe Campaign pada UPLOAD MASSAL kartu produk ("Upload Produk Deal Lama
 * via Excel" di halaman Registrasi Deal).
 *
 * File export TAP tidak membawa tipe campaign, ads budget, service fee, Deal by,
 * maupun PIC TAP — semuanya dimensi komersial MEA. Ditanyakan sekali di form upload
 * lalu diisikan ke SETIAP kartu di file itu, dengan aturan Paid Campaign yang sama
 * seperti form satuan (CLAUDE.md #6): satu file = satu campaign, jadi satu jawaban.
 *
 * (Kolom "Nama BD" tidak ditanyakan: ia = akun yang meng-upload, diisi importer dari
 * sesi login — menanyakannya justru membuka pintu salah tulis pemilik data.)
 */
export const uploadCampaignSchema = z.object({
  campaign_type: z.preprocess(blankToUndefined, z.enum(CAMPAIGN_TYPE_VALUES).optional()),
  ads_budget: optionalNumber(),
  service_fee: optionalNumber(),
  // Deal by & PIC TAP juga tidak ada di export TAP, dan sama-sama satu jawaban per
  // file (satu file = satu deal). Keduanya OPSIONAL: tidak dijawab → kolomnya tidak
  // disentuh sama sekali, bukan dikosongkan.
  deal_by: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  pic_tap: z.preprocess(blankToUndefined, z.string().uuid().optional()),
});

export interface CampaignDefaults {
  campaign_type?: CampaignType;
  ads_budget?: number;
  service_fee?: number;
  deal_by?: string;
  pic_tap?: string;
}

/**
 * Membaca & memvalidasi jawaban tipe campaign dari FormData upload.
 *
 * Mengembalikan pesan (bukan melempar) karena pemanggilnya adalah importer yang
 * melaporkan kegagalan lewat `UploadReport.error` — throw dari server action sudah
 * disensor Next.js di production sehingga pesannya tidak sampai ke user.
 *
 * Tanpa jawaban tipe campaign, `defaults` kosong dan importer tidak menyentuh
 * ketiga kolom itu sama sekali — itulah perilaku "Upload Master Product List" di
 * tab Produk TAP, yang memang tidak menanyakannya.
 */
export function campaignDefaultsFromForm(raw: {
  campaign_type?: unknown;
  ads_budget?: unknown;
  service_fee?: unknown;
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

  const issues = productCardIssues(parsed.data);
  if (Object.keys(issues).length > 0) {
    return { defaults: {}, error: productCardIssueMessage(issues) };
  }
  return { defaults: parsed.data };
}

import { z } from "zod";
import { CAMPAIGN_TYPE_NEEDS_BUDGET, CAMPAIGN_TYPE_VALUES } from "@/lib/deals/campaign-type";
import { productCardIssues } from "@/lib/deals/product-card";

/**
 * Aturan form Edit pada tabel "Shop dari Produk TAP" (tab Deal Brand).
 *
 * Satu baris di tabel itu adalah RINGKASAN banyak kartu produk, jadi mengeditnya
 * berarti menulis ke seluruh kartu shop tersebut di `products_tap`: mengisi Shop ID
 * di sini mengisi Shop ID semua produknya, mengubah Tipe Campaign mengubah tipe
 * semua kartunya. Dua kolom itu saja yang boleh diseragamkan — harga, komisi, dan
 * masa berlaku berbeda per produk, jadi menyamaratakannya justru merusak data
 * (alasan yang sama dengan edit massal di tab Produk TAP).
 *
 * Dipisah dari server action supaya bisa diuji tanpa Next/Supabase, dan supaya
 * aturan "Paid Campaign wajib Ads Budget & Service Fee" tetap dibaca dari
 * `productCardIssues()` yang sama dengan form Registrasi Deal & form Edit kartu
 * (CLAUDE.md #4 — satu sumber kebenaran, bukan tiga salinan).
 */

/**
 * Batas kartu yang boleh ditulis sekali edit. Bukan batas teknis PostgREST
 * melainkan batas kewajaran: seluruh isi baris sebelum-sesudah ikut ditulis ke
 * audit_logs, dan shop dengan ribuan kartu hampir pasti salah kelompok (nama shop
 * kosong menempel ke satu grup) — lebih baik ditolak dengan pesan jelas.
 */
export const SHOP_CARD_LIMIT = 500;

/** Teks kosong dari input yang tidak diisi → undefined. */
function blankToUndefined(v: unknown) {
  return typeof v === "string" && v.trim() === "" ? undefined : v;
}

/** Nominal Rupiah opsional; "" tidak boleh jadi 0, karena 0 adalah nilai yang sah. */
const optionalMoney = z.preprocess(blankToUndefined, z.coerce.number().nonnegative().optional());

export const shopEditSchema = z.object({
  /** Kunci grup shop = kolom generated products_tap.shop_key (migrasi 0043). */
  shop_key: z.string().min(1, "Shop tidak dikenali"),
  shop_id: z.preprocess(
    blankToUndefined,
    z.string().trim().regex(/^\d+$/, "Shop ID harus angka").optional()
  ),
  // "" = jangan ubah tipe campaign. Mengosongkan tipe campaign sengaja TIDAK
  // disediakan di level shop: itu keputusan per kartu, bukan per shop.
  campaign_type: z.preprocess(blankToUndefined, z.enum(CAMPAIGN_TYPE_VALUES).optional()),
  ads_budget: optionalMoney,
  service_fee: optionalMoney,
});

export type ShopEditValues = Omit<z.infer<typeof shopEditSchema>, "shop_key">;

/** Kartu produk apa adanya dari products_tap — hanya kolom yang ikut menentukan hasil. */
export interface ShopCardRow {
  campaign_id: string;
  product_id: string;
  shop_id: string | null;
  campaign_type: string | null;
  ads_budget: number | null;
  service_fee: number | null;
}

export interface ShopCardPlan {
  /** Kartu yang nilainya benar-benar berubah (kartu yang sudah sama tidak ditulis ulang). */
  updates: {
    campaign_id: string;
    product_id: string;
    patch: Record<string, string | number>;
  }[];
  /** Kartu yang akan melanggar aturan Paid Campaign — edit dibatalkan seluruhnya. */
  blocked: { product_id: string; fields: string[] }[];
}

/**
 * Menghitung perubahan yang akan ditulis ke seluruh kartu satu shop.
 *
 * Tiga keputusan yang penting dibaca bersamaan:
 *
 *  1. **Nominal hanya MENGISI yang kosong.** Ads Budget & Service Fee adalah angka
 *     per kartu; menimpanya serempak dengan satu angka akan melipatgandakan total
 *     shop di tabel ringkasan. Isian di form karenanya hanya menyentuh kartu yang
 *     kolomnya masih null — angka yang sudah ada tidak pernah ditindih.
 *  2. **Aturan Paid Campaign ditegakkan hanya saat tipe campaign ditegaskan.** Kalau
 *     user cuma mengisi Shop ID, kartu lama yang kebetulan sudah bertipe paid tanpa
 *     nominal tidak ikut memblokir — memaksa membereskannya di situ berarti Shop ID
 *     tidak bisa dibetulkan sama sekali. Begitu user memilih tipe campaign, barulah
 *     seluruh kartu shop harus memenuhi aturan.
 *  3. **Gagal satu = batal semua.** Yang dikembalikan hanya rencana; caller menulis
 *     setelah `blocked` kosong, jadi tidak pernah ada shop yang setengah terisi.
 */
export function planShopCardEdit(rows: ShopCardRow[], values: ShopEditValues): ShopCardPlan {
  const updates: ShopCardPlan["updates"] = [];
  const blocked: ShopCardPlan["blocked"] = [];

  // Nominal hanya relevan (dan hanya dirender form) saat tipe berbayar dipilih.
  const fillsMoney = values.campaign_type === CAMPAIGN_TYPE_NEEDS_BUDGET;

  for (const row of rows) {
    const patch: Record<string, string | number> = {};

    if (values.shop_id !== undefined && row.shop_id !== values.shop_id) {
      patch.shop_id = values.shop_id;
    }
    if (values.campaign_type !== undefined && row.campaign_type !== values.campaign_type) {
      patch.campaign_type = values.campaign_type;
    }

    let adsBudget = row.ads_budget ?? undefined;
    if (fillsMoney && adsBudget === undefined && values.ads_budget !== undefined) {
      adsBudget = values.ads_budget;
      patch.ads_budget = values.ads_budget;
    }
    let serviceFee = row.service_fee ?? undefined;
    if (fillsMoney && serviceFee === undefined && values.service_fee !== undefined) {
      serviceFee = values.service_fee;
      patch.service_fee = values.service_fee;
    }

    if (values.campaign_type !== undefined) {
      const issues = productCardIssues({
        campaign_type: values.campaign_type,
        ads_budget: adsBudget,
        service_fee: serviceFee,
      });
      const fields = Object.keys(issues);
      if (fields.length > 0) {
        blocked.push({ product_id: row.product_id, fields });
        continue;
      }
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ campaign_id: row.campaign_id, product_id: row.product_id, patch });
    }
  }

  return { updates, blocked };
}

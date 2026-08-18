import { z } from "zod";
import { CAMPAIGN_TYPE_VALUES } from "@/lib/deals/campaign-type";

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
 * Ads Budget & Service Fee TIDAK lagi diisi dari sini: keduanya nominal per deal
 * yang kini dikelola per shop di tab Project BD (satu tempat entri, bukan tersebar).
 * Karena nominalnya tak lagi bisa diisi di form ini, aturan "Paid Campaign wajib
 * Ads Budget & Service Fee" juga tidak ditegakkan di jalur ini — menegakkannya
 * berarti Tipe Campaign paid tak akan pernah bisa dipilih untuk shop yang kartunya
 * belum berisi nominal.
 *
 * Dipisah dari server action supaya bisa diuji tanpa Next/Supabase.
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
});

export type ShopEditValues = Omit<z.infer<typeof shopEditSchema>, "shop_key">;

/** Kartu produk apa adanya dari products_tap — hanya kolom yang ikut menentukan hasil. */
export interface ShopCardRow {
  campaign_id: string;
  product_id: string;
  shop_id: string | null;
  campaign_type: string | null;
}

export interface ShopCardPlan {
  /** Kartu yang nilainya benar-benar berubah (kartu yang sudah sama tidak ditulis ulang). */
  updates: {
    campaign_id: string;
    product_id: string;
    patch: Record<string, string>;
  }[];
}

/**
 * Menghitung perubahan yang akan ditulis ke seluruh kartu satu shop.
 *
 * Hanya Shop ID & Tipe Campaign yang diseragamkan — keduanya sah sama untuk semua
 * kartu shop. Kartu yang nilainya sudah sesuai tidak ikut ditulis ulang, jadi
 * jejak audit hanya memuat kartu yang benar-benar berubah.
 */
export function planShopCardEdit(rows: ShopCardRow[], values: ShopEditValues): ShopCardPlan {
  const updates: ShopCardPlan["updates"] = [];

  for (const row of rows) {
    const patch: Record<string, string> = {};

    if (values.shop_id !== undefined && row.shop_id !== values.shop_id) {
      patch.shop_id = values.shop_id;
    }
    if (values.campaign_type !== undefined && row.campaign_type !== values.campaign_type) {
      patch.campaign_type = values.campaign_type;
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ campaign_id: row.campaign_id, product_id: row.product_id, patch });
    }
  }

  return { updates };
}

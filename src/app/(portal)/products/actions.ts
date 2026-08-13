"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { parsePriceCell, uploadProductMasterList } from "@/lib/m10/products";
import { parseCommission } from "@/lib/utils/commission";
import { priceSegmentOf, type PriceBounds } from "@/lib/projection/gmv";
import type { UploadReport } from "@/app/(portal)/tim/actions";

/** Thin wrapper around the m10 parser so the upload form revalidates this page. */
export async function uploadMasterProducts(formData: FormData): Promise<UploadReport> {
  const report = await uploadProductMasterList(formData);
  revalidatePath("/products");
  return report;
}

export type ProductEditState = { ok: boolean; message: string } | null;

/** Field master yang boleh diperbaiki manual dari tabel (bukan metrik hasil upload). */
const EDITABLE_TEXT = [
  "product_name",
  "shop_id",
  "shop_name",
  "level1_category",
  "level2_category",
  "product_link",
] as const;

/**
 * Edit satu baris katalog Produk TAP.
 *
 * Yang boleh diubah HANYA atribut master produk (nama, shop, kategori, harga, rate
 * komisi, link, status aktif). Metrik performa (Affiliate GMV, orders, items sold,
 * komisi nominal, jumlah kreator) TIDAK bisa diedit: itu hasil upload data platform
 * dan satu-satunya sumbernya adalah file export — mengedit manual akan membuat
 * angka di katalog berbeda dari angka platform.
 *
 * price_segment selalu dihitung ulang dari harga baru memakai app_config
 * `segments.price_bounds` (CLAUDE.md: threshold tidak pernah di-hardcode), dan
 * `needs_review` otomatis lepas begitu harga + rate komisi sudah terisi bersih.
 * Setiap perubahan ditulis ke audit_logs.
 */
export async function updateProduct(
  _prev: ProductEditState,
  formData: FormData
): Promise<ProductEditState> {
  try {
    const actor = await requirePermission("products.edit");
    const productId = String(formData.get("product_id") ?? "").trim();
    if (!productId) throw new Error("Product ID wajib diisi");
    // Kunci baris = (campaign_id, product_id) sejak 0040. Tanpa menyaring
    // campaign, satu edit akan mengubah baris produk ini di SEMUA campaign —
    // termasuk milik akun lain.
    const campaignId = String(formData.get("campaign_id") ?? "").trim() || "-";

    const admin = createAdminClient();
    const { data: before } = await admin
      .from("products_tap")
      .select(
        "product_id, campaign_id, product_name, shop_id, shop_name, level1_category, level2_category, price, price_segment, commission_pct, commission_note, partner_commission_pct, product_link, active, needs_review"
      )
      .eq("product_id", productId)
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (!before) throw new Error(`Produk ${productId} tidak ditemukan`);

    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_TEXT) {
      const raw = formData.get(field);
      if (raw === null) continue;
      patch[field] = String(raw).trim() || null;
    }

    // Harga: kosong = "belum diketahui" (null), bukan 0.
    const priceRaw = String(formData.get("price") ?? "").trim();
    const price = priceRaw === "" ? null : parsePriceCell(priceRaw);
    if (priceRaw !== "" && price === null) {
      throw new Error(`Harga "${priceRaw}" tidak terbaca sebagai angka Rupiah`);
    }
    patch.price = price;
    const bounds = await getConfig<PriceBounds>("segments.price_bounds");
    patch.price_segment = price !== null && price > 0 ? priceSegmentOf(price, bounds) : null;

    // Rate komisi kreator & partner (persen). Nilai kotor ditolak di sini — form
    // ini justru alat untuk MEMBERSIHKAN baris yang ditandai perlu review.
    const commissionRaw = String(formData.get("commission_pct") ?? "").trim();
    const commission = commissionRaw === "" ? null : parseCommission(commissionRaw);
    if (commissionRaw !== "" && commission === null) {
      throw new Error(`Komisi kreator "${commissionRaw}" tidak valid (isi angka persen, mis. 12 atau 5-7)`);
    }
    patch.commission_pct = commission ? (commission.min + commission.max) / 2 : null;
    patch.commission_note = commission?.isRange ? `range ${commission.min}-${commission.max}%` : null;

    const partnerRaw = String(formData.get("partner_commission_pct") ?? "").trim();
    const partner = partnerRaw === "" ? null : parseCommission(partnerRaw);
    if (partnerRaw !== "" && partner === null) {
      throw new Error(`Komisi partner "${partnerRaw}" tidak valid (isi angka persen, mis. 3)`);
    }
    patch.partner_commission_pct = partner ? (partner.min + partner.max) / 2 : null;

    patch.active = formData.get("active") === "on";
    // Baris dianggap bersih begitu harga & rate komisi kreator terisi valid.
    patch.needs_review = price === null || commission === null;
    patch.updated_at = new Date().toISOString();

    const { error } = await admin
      .from("products_tap")
      .update(patch)
      .eq("product_id", productId)
      .eq("campaign_id", campaignId);
    if (error) throw new Error(`Gagal menyimpan: ${error.message}`);

    await writeAudit({
      actorId: actor.id,
      action: "products_tap.update",
      entityType: "products_tap",
      entityId: productId,
      before,
      after: patch,
      type: "auto", // memperbaiki data master tidak merugikan; tetap terekam penuh
    });

    revalidatePath("/products");
    return { ok: true, message: "Produk tersimpan." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal menyimpan produk" };
  }
}

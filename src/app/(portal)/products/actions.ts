"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { hasPermission, requirePermission } from "@/lib/rbac";
import { parsePriceCell, uploadProductMasterList } from "@/lib/m10/products";
import {
  BULK_LIMIT, groupKeysByCampaign, parseProductRowKeys,
} from "@/lib/m10/product-keys";
import { CAMPAIGN_TYPE_VALUES } from "@/lib/deals/campaign-type";
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
        "product_id, campaign_id, product_name, shop_id, shop_name, level1_category, level2_category, price, price_segment, commission_pct, commission_note, partner_commission_pct, product_link, active, needs_review, campaign_type, deal_by, pic_tap, uploaded_by"
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

    // Dimensi kartu deal. Field yang tidak dirender form (mis. Nama BD untuk role
    // yang tidak boleh melihatnya) tidak ada di FormData → dilewati, BUKAN dikosongkan.
    const campaignTypeRaw = formData.get("campaign_type");
    if (campaignTypeRaw !== null) {
      const value = String(campaignTypeRaw).trim();
      if (value && !(CAMPAIGN_TYPE_VALUES as readonly string[]).includes(value)) {
        throw new Error(`Tipe campaign "${value}" tidak dikenal`);
      }
      patch.campaign_type = value || null;
    }
    for (const field of ["deal_by", "pic_tap"] as const) {
      const raw = formData.get(field);
      if (raw === null) continue;
      patch[field] = memberIdOrNull(String(raw), field);
    }
    // Nama BD = pemilik baris. Hanya role yang memang boleh MELIHAT kolom itu yang
    // boleh memindahkannya; kalau tidak, isian diabaikan tanpa mengubah apa pun.
    const ownerRaw = formData.get("uploaded_by");
    if (ownerRaw !== null && hasPermission("products.view_owner_name", actor.role)) {
      patch.uploaded_by = memberIdOrNull(String(ownerRaw), "uploaded_by");
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

/** uuid anggota tim dari dropdown; "" = kosongkan kolomnya. */
function memberIdOrNull(raw: string, field: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Pilihan ${field} tidak valid`);
  }
  return value;
}

export type ProductBulkState = { ok: boolean; message: string } | null;

/**
 * Edit massal baris terpilih di tabel Produk TAP — kolom Shop ID & Shop Name saja.
 *
 * Dua kolom itu yang memang sering salah serempak: satu campaign di-upload dengan
 * shop kosong / shop id ketukar, dan memperbaikinya satu per satu untuk puluhan
 * baris tidak masuk akal. Kolom lain sengaja TIDAK ikut: harga, komisi, dan masa
 * berlaku berbeda per produk, jadi menyeragamkannya massal justru merusak data.
 *
 * Kolom yang dikosongkan di form = TIDAK diubah (bukan dikosongkan di database) —
 * kalau tidak, edit "isi shop name saja" akan menghapus shop id semua baris.
 */
export async function bulkUpdateProducts(
  _prev: ProductBulkState,
  formData: FormData
): Promise<ProductBulkState> {
  try {
    const actor = await requirePermission("products.edit");
    const keys = parseProductRowKeys(String(formData.get("keys") ?? "[]"));
    if (keys.length === 0) throw new Error("Belum ada produk yang dipilih");
    if (keys.length > BULK_LIMIT) {
      throw new Error(`Maksimal ${BULK_LIMIT} produk sekali edit (terpilih ${keys.length})`);
    }

    const shopId = String(formData.get("shop_id") ?? "").trim();
    const shopName = String(formData.get("shop_name") ?? "").trim();
    if (!shopId && !shopName) throw new Error("Isi Shop ID dan/atau Shop Name yang mau diseragamkan");
    if (shopId && !/^\d+$/.test(shopId)) throw new Error(`Shop ID "${shopId}" harus angka`);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (shopId) patch.shop_id = shopId;
    if (shopName) patch.shop_name = shopName;

    const admin = createAdminClient();
    const byCampaign = groupKeysByCampaign(keys);
    const before: unknown[] = [];
    let updated = 0;
    for (const [campaignId, productIds] of byCampaign) {
      const { data: rows } = await admin
        .from("products_tap")
        .select("campaign_id, product_id, shop_id, shop_name")
        .eq("campaign_id", campaignId)
        .in("product_id", productIds);
      before.push(...(rows ?? []));

      const { data, error } = await admin
        .from("products_tap")
        .update(patch)
        .eq("campaign_id", campaignId)
        .in("product_id", productIds)
        .select("product_id");
      if (error) throw new Error(`Gagal menyimpan: ${error.message}`);
      updated += data?.length ?? 0;
    }

    await writeAudit({
      actorId: actor.id,
      action: "products_tap.bulk_update",
      entityType: "products_tap",
      entityId: null,
      before,
      after: { patch, rows: updated },
      type: "auto", // memperbaiki data master tidak merugikan; tetap terekam penuh
    });

    revalidatePath("/products");
    return { ok: true, message: `${updated} produk diperbarui.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal edit massal" };
  }
}

/**
 * Hapus massal baris terpilih di tabel Produk TAP.
 *
 * SELURUH isi baris ditulis ke audit_logs sebelum dihapus (CLAUDE.md #2): hapus
 * massal adalah aksi manusia yang bisa merugikan, dan satu-satunya jaring pengaman
 * yang benar-benar berguna adalah datanya masih ada di jejak audit. Batas per
 * operasi menjaga payload itu tetap wajar.
 *
 * Catatan: baris hasil derive ingest mingguan akan muncul lagi pada ingest
 * berikutnya — itu memang perilaku yang benar, sumbernya file platform.
 */
export async function bulkDeleteProducts(
  _prev: ProductBulkState,
  formData: FormData
): Promise<ProductBulkState> {
  try {
    const actor = await requirePermission("products.delete");
    const keys = parseProductRowKeys(String(formData.get("keys") ?? "[]"));
    if (keys.length === 0) throw new Error("Belum ada produk yang dipilih");
    if (keys.length > BULK_LIMIT) {
      throw new Error(`Maksimal ${BULK_LIMIT} produk sekali hapus (terpilih ${keys.length})`);
    }
    // Konfirmasi kedua ikut dikirim form supaya tombol yang tak sengaja ter-submit
    // (mis. Enter di modal) tidak pernah menghapus apa pun.
    if (String(formData.get("confirm") ?? "") !== "HAPUS") {
      throw new Error('Ketik HAPUS pada kotak konfirmasi untuk melanjutkan');
    }

    const admin = createAdminClient();
    const byCampaign = groupKeysByCampaign(keys);
    const deleted: unknown[] = [];
    for (const [campaignId, productIds] of byCampaign) {
      const { data, error } = await admin
        .from("products_tap")
        .delete()
        .eq("campaign_id", campaignId)
        .in("product_id", productIds)
        .select("*");
      if (error) throw new Error(`Gagal menghapus: ${error.message}`);
      deleted.push(...(data ?? []));
    }

    await writeAudit({
      actorId: actor.id,
      action: "products_tap.bulk_delete",
      entityType: "products_tap",
      entityId: null,
      // Isi lengkap baris yang dihapus = satu-satunya jalan pulih kalau salah pilih.
      before: deleted,
      after: { rows: deleted.length },
      type: "auto",
    });

    revalidatePath("/products");
    return { ok: true, message: `${deleted.length} produk dihapus (tercatat di audit log).` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal hapus massal" };
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelationError, MIGRATION_0087_MISSING, MIGRATION_0088_MISSING } from "@/lib/db/missing-migration";
import type { CreatorShopPeriodRow, UnattributedTapShopRow } from "./aggregate";

/** Bulk-delete chunk size for `.in(creator_id, [...])` (consistent with run.ts). */
const DELETE_CHUNK = 200;

export interface ShopPeriodWriteResult {
  written: number;
  /** Set when the table does not exist yet (migrasi 0087 belum di-apply) — ingest continues. */
  skipped: string | null;
}

/**
 * Idempotent PER (platform × creator × week), same design as writeAggregates:
 * delete this file's creators for this period_start, then insert. Writes via the
 * service-role client only (RLS select-only, migrasi 0087).
 *
 * Until migration 0087 is applied the table does not exist: that is reported as
 * `skipped` (the weekly performance aggregates are already committed and must not
 * fail because of a newer, optional table). Any OTHER error throws, like the
 * other aggregate writers.
 */
export async function writeCreatorShopPeriod(
  admin: SupabaseClient,
  platform: "tiktok" | "shopee",
  batchId: string,
  creatorIds: string[],
  periodStart: string,
  periodEnd: string,
  rows: CreatorShopPeriodRow[],
  unattributed: UnattributedTapShopRow[] = []
): Promise<ShopPeriodWriteResult> {
  for (let i = 0; i < creatorIds.length; i += DELETE_CHUNK) {
    const chunk = creatorIds.slice(i, i + DELETE_CHUNK);
    if (chunk.length === 0) continue;
    const { error } = await admin.from("creator_shop_period_gmv").delete()
      .eq("platform", platform).eq("period_start", periodStart).in("creator_id", chunk);
    if (error) {
      if (isMissingRelationError(error)) return { written: 0, skipped: `Agregat per shop dilewati: ${MIGRATION_0087_MISSING}` };
      throw new Error(`Gagal menghapus creator_shop_period_gmv lama: ${error.message}`);
    }
  }

  const payload = rows.map((r) => ({
    platform,
    creator_id: r.creatorId,
    shop_id: r.shopId,
    shop_name: r.shopName,
    period_start: periodStart,
    period_end: periodEnd,
    upload_batch: batchId,
    gmv_mcn: r.gmvMcn,
    gmv_mcn_live: r.gmvMcnLive,
    gmv_mcn_video: r.gmvMcnVideo,
    orders_mcn: r.ordersMcn,
    items_sold_mcn: r.itemsSoldMcn,
    gmv_tap: r.gmvTap,
    gmv_tap_live: r.gmvTapLive,
    gmv_tap_video: r.gmvTapVideo,
    orders_tap: r.ordersTap,
    est_partner_commission: r.estPartnerCommission,
    actual_partner_commission: r.actualPartnerCommission,
    est_creator_commission: r.estCreatorCommission,
    actual_creator_commission: r.actualCreatorCommission,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin.from("creator_shop_period_gmv").insert(payload.slice(i, i + 500));
    if (error) {
      if (isMissingRelationError(error)) return { written: 0, skipped: `Agregat per shop dilewati: ${MIGRATION_0087_MISSING}` };
      throw new Error(`Gagal menulis creator_shop_period_gmv: ${error.message}`);
    }
  }
  const skipped = await writeUnattributedTap(admin, platform, batchId, creatorIds, periodStart, periodEnd, unattributed);
  return { written: payload.length, skipped };
}

/**
 * GMV TAP tanpa kreator per shop (K6, migrasi 0088). Lingkup hapus = upload lama yang
 * memuat kreator mana pun dari file ini untuk minggu yang sama (`source_creator_ids`
 * overlap) — sama dengan creator_shop_period_gmv yang dihapus per kreator × minggu,
 * jadi upload ulang file yang dikoreksi tidak menggandakan angka.
 * Tabel belum ada → pesan (bila ada yang mau ditulis), ingest tetap jalan.
 */
async function writeUnattributedTap(
  admin: SupabaseClient,
  platform: "tiktok" | "shopee",
  batchId: string,
  creatorIds: string[],
  periodStart: string,
  periodEnd: string,
  rows: UnattributedTapShopRow[]
): Promise<string | null> {
  const missing = () =>
    rows.length > 0 ? `GMV TAP tanpa nama kreator tidak disimpan: ${MIGRATION_0088_MISSING}` : null;
  // Same batch re-run (e.g. no creator resolved → empty overlap scope) must not hit the PK.
  const { error: batchError } = await admin.from("creator_shop_period_unattributed_tap").delete()
    .eq("platform", platform).eq("upload_batch", batchId);
  if (batchError) {
    if (isMissingRelationError(batchError)) return missing();
    throw new Error(`Gagal menghapus creator_shop_period_unattributed_tap lama: ${batchError.message}`);
  }
  for (let i = 0; i < creatorIds.length; i += DELETE_CHUNK) {
    const chunk = creatorIds.slice(i, i + DELETE_CHUNK);
    if (chunk.length === 0) continue;
    const { error } = await admin.from("creator_shop_period_unattributed_tap").delete()
      .eq("platform", platform).eq("period_start", periodStart).overlaps("source_creator_ids", chunk);
    if (error) {
      if (isMissingRelationError(error)) return missing();
      throw new Error(`Gagal menghapus creator_shop_period_unattributed_tap lama: ${error.message}`);
    }
  }
  if (rows.length === 0) return null;
  const payload = rows.map((u) => ({
    platform,
    shop_id: u.shopId,
    shop_name: u.shopName,
    period_start: periodStart,
    period_end: periodEnd,
    upload_batch: batchId,
    source_creator_ids: creatorIds,
    gmv_tap: u.gmvTap,
    gmv_tap_live: u.gmvTapLive,
    gmv_tap_video: u.gmvTapVideo,
    orders_tap: u.ordersTap,
    est_partner_commission: u.estPartnerCommission,
    actual_partner_commission: u.actualPartnerCommission,
    est_creator_commission: u.estCreatorCommission,
    actual_creator_commission: u.actualCreatorCommission,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin.from("creator_shop_period_unattributed_tap").insert(payload.slice(i, i + 500));
    if (error) {
      if (isMissingRelationError(error)) return missing();
      throw new Error(`Gagal menulis creator_shop_period_unattributed_tap: ${error.message}`);
    }
  }
  return null;
}

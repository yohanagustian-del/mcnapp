import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelationError, MIGRATION_0087_MISSING, MIGRATION_0089_MISSING } from "@/lib/db/missing-migration";
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

const UNATTRIBUTED = "creator_shop_period_unattributed_tap";
const UNATTRIBUTED_SCOPE = "creator_shop_period_unattributed_scope";

/**
 * GMV TAP tanpa kreator per shop (K6, migrasi 0088/0089). Lingkup hapus = batch ini +
 * upload lama minggu yang sama yang memuat kreator mana pun dari file ini (dicari di
 * creator_shop_period_unattributed_scope) — sama dengan creator_shop_period_gmv yang
 * dihapus per kreator × minggu, jadi upload ulang file yang dikoreksi tidak menggandakan
 * angka. Lingkup disimpan per batch × kreator (0089), BUKAN sebagai array di tiap baris
 * shop: ±1.600 kreator × puluhan ribu shop membuat insert 0088 timeout.
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
    rows.length > 0 ? `GMV TAP tanpa nama kreator tidak disimpan: ${MIGRATION_0089_MISSING}` : null;
  const fail = (what: string, error: { message: string }) => {
    throw new Error(`Gagal ${what} ${UNATTRIBUTED}: ${error.message}`);
  };

  // 1. Batches to replace: this one (re-run of the same file) + older uploads of this
  //    week sharing any creator with this file.
  const batches = new Set<string>([batchId]);
  for (let i = 0; i < creatorIds.length; i += DELETE_CHUNK) {
    const chunk = creatorIds.slice(i, i + DELETE_CHUNK);
    const { data, error } = await admin.from(UNATTRIBUTED_SCOPE).select("upload_batch")
      .eq("platform", platform).eq("period_start", periodStart).in("creator_id", chunk);
    if (error) {
      if (isMissingRelationError(error)) return missing();
      fail("membaca lingkup", error);
    }
    for (const r of (data ?? []) as { upload_batch: string }[]) batches.add(r.upload_batch);
  }

  // 2. Remove those batches' rows and scopes.
  const batchList = [...batches];
  for (let i = 0; i < batchList.length; i += DELETE_CHUNK) {
    const chunk = batchList.slice(i, i + DELETE_CHUNK);
    for (const table of [UNATTRIBUTED, UNATTRIBUTED_SCOPE]) {
      const { error } = await admin.from(table).delete().eq("platform", platform).in("upload_batch", chunk);
      if (error) {
        if (isMissingRelationError(error)) return missing();
        fail("menghapus", error);
      }
    }
  }
  if (rows.length === 0) return null;

  // 3. Write this batch's scope, then its rows.
  const scope = creatorIds.map((creatorId) => ({
    platform, upload_batch: batchId, period_start: periodStart, creator_id: creatorId,
  }));
  const payload = rows.map((u) => ({
    platform,
    shop_id: u.shopId,
    shop_name: u.shopName,
    period_start: periodStart,
    period_end: periodEnd,
    upload_batch: batchId,
    gmv_tap: u.gmvTap,
    gmv_tap_live: u.gmvTapLive,
    gmv_tap_video: u.gmvTapVideo,
    orders_tap: u.ordersTap,
    est_partner_commission: u.estPartnerCommission,
    actual_partner_commission: u.actualPartnerCommission,
    est_creator_commission: u.estCreatorCommission,
    actual_creator_commission: u.actualCreatorCommission,
  }));
  const writes: [string, Record<string, unknown>[]][] = [[UNATTRIBUTED_SCOPE, scope], [UNATTRIBUTED, payload]];
  for (const [table, list] of writes) {
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await admin.from(table).insert(list.slice(i, i + 500));
      if (error) {
        if (isMissingRelationError(error)) return missing();
        fail("menulis", error);
      }
    }
  }
  return null;
}

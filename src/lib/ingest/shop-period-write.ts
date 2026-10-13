import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelationError, MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import type { CreatorShopPeriodRow } from "./aggregate";

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
  rows: CreatorShopPeriodRow[]
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
  return { written: payload.length, skipped: null };
}

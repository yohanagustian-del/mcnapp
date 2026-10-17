import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelationError } from "@/lib/db/missing-migration";

/**
 * Number of shop slices per refresh — MUST equal the `& 31` mask in
 * refresh_shop_period_rollup_slice (migrasi 0094). Guarded by a test.
 */
export const SHOP_PERIOD_SLICES = 32;
const GRAINS = ["week", "month"] as const;
/** Parallel rpc calls; each slice is one short statement (< the 8s statement_timeout). */
const CONCURRENCY = 4;

export const MIGRATION_0094_MISSING =
  "Migrasi 0094 belum di-apply (tabel ringkasan shop_period_rollup / fungsi refresh_shop_period_rollup_slice). Hubungi admin untuk menjalankan migrasinya.";

/**
 * Rewrites the stored week + month rollup (shop_period_rollup / creator_shop_rollup,
 * migrasi 0094) for the period just written by writeCreatorShopPeriod — the single
 * writer of those tables. The aggregation itself stays in SQL (views *_live); this
 * only drives it slice by slice so no call hits the 8s statement_timeout, then
 * publishes the generation with finish_shop_period_rollup.
 *
 * Returns null on success, or a message for the upload notes. Never throws: the
 * weekly aggregates are already committed and must not fail because of the rollup.
 * A slice that fails twice leaves the previous generation in place (readers keep
 * seeing complete, older totals) — re-uploading the week repairs it.
 */
export async function refreshShopPeriodRollup(
  admin: SupabaseClient,
  platform: "tiktok" | "shopee",
  periodStart: string
): Promise<string | null> {
  const generation = new Date().toISOString();
  const jobs = GRAINS.flatMap((grain) =>
    Array.from({ length: SHOP_PERIOD_SLICES }, (_, slice) => ({ grain, slice }))
  );

  let failure: string | null = null;
  let missing = false;
  let next = 0;
  async function worker() {
    while (next < jobs.length && !failure && !missing) {
      const { grain, slice } = jobs[next++];
      const args = {
        p_platform: platform, p_period_start: periodStart, p_grain: grain, p_slice: slice, p_generation: generation,
      };
      let { error } = await admin.rpc("refresh_shop_period_rollup_slice", args);
      if (error && !isMissingRelationError(error)) {
        ({ error } = await admin.rpc("refresh_shop_period_rollup_slice", args));
      }
      if (error) {
        if (isMissingRelationError(error)) missing = true;
        else failure = `${grain} irisan ${slice}: ${error.message}`;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (missing) return `Ringkasan per shop tidak diperbarui: ${MIGRATION_0094_MISSING}`;
  if (failure) {
    return `Ringkasan per shop (Summary BizDev, TAP Matchmaking, Report Brand) gagal diperbarui ` +
      `(${failure}) — angka di halaman itu masih versi sebelum upload ini. Upload ulang minggu ini untuk memperbaiki.`;
  }

  const { error } = await admin.rpc("finish_shop_period_rollup", {
    p_platform: platform, p_period_start: periodStart, p_generation: generation,
  });
  if (error) {
    if (isMissingRelationError(error)) return `Ringkasan per shop tidak diperbarui: ${MIGRATION_0094_MISSING}`;
    return `Ringkasan per shop gagal diterbitkan (${error.message}) — upload ulang minggu ini untuk memperbaiki.`;
  }
  return null;
}

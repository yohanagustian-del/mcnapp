import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { buildMonthlyAverages, type AvgMonthlyGmv, type AvgMonthlyGmvInputRow } from "@/lib/m8/weekly-growth";

/**
 * Shared creator auto-fill helpers (CLAUDE.md #4 — one implementation, reused by
 * both TikTok (src/lib/ingest/run.ts) and Shopee (src/lib/ingest/shopee-run.ts)
 * pipelines instead of two copies of the same monthly-average query + update/audit
 * dance). Platform-specific fields (niche/top_niches, ranked from each
 * pipeline's own category-GMV breakdown) stay in each caller — both TikTok
 * (run.ts) and Shopee (shopee-run.ts) merge them in via the same pattern.
 */

/**
 * Reads the FULL creator_period_summary history for the given creator ids
 * (all batches/periods/platforms — the table is not platform-scoped) and
 * returns the monthly-average GMV per creator (task A.1 convention: average of
 * each month's TOTAL, across every month with data). Must be called AFTER the
 * caller's own writeAggregates-equivalent has already delete-then-inserted this
 * batch's rows, so the just-ingested weeks are included in the average.
 */
export async function fetchMonthlyAvgGmvByCreator(
  admin: SupabaseClient,
  creatorIds: string[]
): Promise<Map<string, AvgMonthlyGmv>> {
  const result = new Map<string, AvgMonthlyGmv>();
  if (creatorIds.length === 0) return result;

  const { data: allPeriodRows, error } = await admin
    .from("creator_period_summary")
    .select("creator_id, period_start, gmv_total, affiliate_live_gmv, affiliate_video_gmv, created_at")
    .in("creator_id", creatorIds);
  if (error) throw new Error(`Gagal membaca histori creator_period_summary: ${error.message}`);

  const periodRowsByCreator = new Map<string, AvgMonthlyGmvInputRow[]>();
  for (const r of allPeriodRows ?? []) {
    const row: AvgMonthlyGmvInputRow = {
      creatorId: r.creator_id as string,
      periodStart: r.period_start as string,
      createdAt: r.created_at as string,
      gmvTotal: Number(r.gmv_total ?? 0),
      affiliateLiveGmv: Number(r.affiliate_live_gmv ?? 0),
      affiliateVideoGmv: Number(r.affiliate_video_gmv ?? 0),
    };
    const list = periodRowsByCreator.get(row.creatorId) ?? [];
    list.push(row);
    periodRowsByCreator.set(row.creatorId, list);
  }

  for (const creatorId of creatorIds) {
    result.set(creatorId, buildMonthlyAverages(periodRowsByCreator.get(creatorId) ?? []));
  }
  return result;
}

export interface ExistingCreatorRow {
  id: string;
  status: string | null;
  platform: string | null;
  jenis_creator: string | null;
}

/**
 * Computes the shared update fields (status→aktif, platform, gmv/gmv_live/
 * gmv_video averages, jenis_creator) + before/after audit payload for ONE
 * creator. Caller merges platform-specific fields (e.g. niche) into the
 * returned `updates`/`before`/`after` objects before writing, then calls
 * `writeCreatorAutoFillUpdate` (or does its own update+audit) — kept as two
 * steps so TikTok's niche merge can slot in between without this helper
 * needing to know about niche at all.
 */
export function computeSharedAutoFillFields(
  existing: ExistingCreatorRow | undefined,
  platformValue: "tiktok" | "shopee",
  jenisCreator: "live" | "vt" | "live & vt" | null,
  avgGmv: AvgMonthlyGmv
): { updates: Record<string, unknown>; before: Record<string, unknown>; after: Record<string, unknown> } {
  const updates: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (existing && existing.status !== "aktif") {
    updates.status = "aktif";
    before.status = existing.status;
    after.status = "aktif";
  }
  if (!existing || existing.platform !== platformValue) {
    updates.platform = platformValue;
    before.platform = existing?.platform ?? null;
    after.platform = platformValue;
  }
  // gmv/gmv_live/gmv_video = average of monthly totals (task A.1), computed from
  // the WHOLE creator_period_summary history for this creator — not this batch's total.
  updates.gmv = avgGmv.gmv;
  after.gmv = avgGmv.gmv;
  updates.gmv_live = avgGmv.gmvLive;
  after.gmv_live = avgGmv.gmvLive;
  updates.gmv_video = avgGmv.gmvVideo;
  after.gmv_video = avgGmv.gmvVideo;

  if (jenisCreator && jenisCreator !== existing?.jenis_creator) {
    updates.jenis_creator = jenisCreator;
    before.jenis_creator = existing?.jenis_creator ?? null;
    after.jenis_creator = jenisCreator;
  }

  return { updates, before, after };
}

/** Writes the update + audit row for one creator (shared by both pipelines). */
export async function writeCreatorAutoFillUpdate(
  admin: SupabaseClient,
  actorId: string,
  creatorId: string,
  updates: Record<string, unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<void> {
  const { error: updateError } = await admin.from("creators").update(updates).eq("id", creatorId);
  if (updateError) throw new Error(`Gagal auto-update creator ${creatorId}: ${updateError.message}`);

  await writeAudit({
    actorId,
    action: "creator.auto_fill_from_upload",
    entityType: "creators",
    entityId: creatorId,
    before,
    after,
    type: "auto",
  });
}

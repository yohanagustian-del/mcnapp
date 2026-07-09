import { createAdminClient } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  aggregateFromSubcatSegmentRows,
  projectGmvRange,
  slotKey,
  type GmvProjection,
  type PriceSegment,
  type ProjectionConfig,
  type SubcatSegmentGmvRow,
} from "./gmv";

/** Loads the shared projection tunables from app_config (M5 & M6 read the SAME keys). */
export async function loadProjectionConfig(): Promise<ProjectionConfig> {
  const [windowDays, spread, levelFactors, bounds] = await Promise.all([
    getConfig<number>("projection.window_days"),
    getConfig<number>("projection.spread"),
    getConfig<Record<string, number>>("projection.level_factors"),
    getConfig<ProjectionConfig["bounds"]>("segments.price_bounds"),
  ]);
  return { windowDays, spread, levelFactors, bounds };
}

/** Rolling-window start (ISO date) for a given day count, ending today. */
export function windowStart(windowDays: number, today = new Date()): string {
  return new Date(today.getTime() - windowDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Creator history rows inside the rolling window — Module 0.5 Fase 2:
 * creator_subcat_segment_gmv is the source of truth for M5/M6 (grain = creator
 * × level2 category × price segment, already aggregated at ingest time),
 * replacing a fresh aggregateHistory() pass over transactions_all raw rows
 * (which are dropped after ingest per Module 0.5 §2.7 — reading them here would
 * silently return empty once drop-raw runs). Window filter uses `window_end`
 * (the ingest-time period_end of the batch that produced each row).
 */
export async function fetchWindowHistory(
  cutoff: string,
  creatorId?: string
): Promise<SubcatSegmentGmvRow[]> {
  const admin = createAdminClient();
  return fetchAll<SubcatSegmentGmvRow>(
    admin,
    "creator_subcat_segment_gmv",
    "creator_id, level2_category, price_segment, gmv, live_gmv",
    (q) => {
      const filtered = q.gte("window_end", cutoff);
      return creatorId ? filtered.eq("creator_id", creatorId) : filtered;
    }
  );
}

/**
 * projectGmv — THE shared projection entry point (CLAUDE.md #8, one implementation
 * for M5 & M6). Basis = creator's GMV over the rolling window on the same
 * (Level 2 sub-category, price segment); formula lives in projectGmvRange().
 * Always a range + disclaimer, never a single number.
 */
export async function projectGmv(
  creatorId: string,
  subCategory: string,
  priceSegment: PriceSegment,
  windowDays?: number
): Promise<GmvProjection> {
  const cfg = await loadProjectionConfig();
  const days = windowDays ?? cfg.windowDays;
  const admin = createAdminClient();

  const { data: creator, error } = await admin
    .from("creators")
    .select("id, level")
    .eq("id", creatorId)
    .maybeSingle();
  if (error) throw new Error(`projectGmv: gagal membaca creator: ${error.message}`);
  if (!creator) throw new Error(`projectGmv: creator ${creatorId} tidak ditemukan`);

  const rows = await fetchWindowHistory(windowStart(days), creatorId);
  const { bySlot } = aggregateFromSubcatSegmentRows(rows);
  const basis = bySlot.get(slotKey(creatorId, subCategory, priceSegment)) ?? 0;
  return projectGmvRange(basis, creator.level, { ...cfg, windowDays: days });
}

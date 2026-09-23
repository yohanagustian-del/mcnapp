import { createAdminClient } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { ProjectionConfig, SubcatSegmentGmvRow } from "./gmv";

/** Loads the shared projection tunables from app_config (Product Match & M6 pool model read the SAME keys). */
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
 * creator_subcat_segment_gmv is the source of truth (grain = creator ×
 * level2 category × price segment, already aggregated at ingest time),
 * replacing a fresh aggregateHistory() pass over transactions_all raw rows
 * (which are dropped after ingest per Module 0.5 §2.7 — reading them here would
 * silently return empty once drop-raw runs). Window filter uses `window_end`
 * (the ingest-time period_end of the batch that produced each row).
 *
 * Reused by lib/product-match/data.ts (Creator Product Match) and
 * predictor/pool-actions.ts (BD Value Predictor pool model) — CLAUDE.md #4,
 * one window/history query, not a second one per feature.
 */
export async function fetchWindowHistory(
  cutoff: string,
  creatorId?: string
): Promise<SubcatSegmentGmvRow[]> {
  const admin = createAdminClient();
  return fetchAll<SubcatSegmentGmvRow>(
    admin,
    "creator_subcat_segment_gmv",
    "creator_id, level2_category, price_segment, gmv, live_gmv, orders",
    (q) => {
      const filtered = q.gte("window_end", cutoff);
      return creatorId ? filtered.eq("creator_id", creatorId) : filtered;
    }
  );
}

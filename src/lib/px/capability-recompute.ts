import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { loadProjectionConfig, windowStart } from "@/lib/projection/project-gmv";

/**
 * PX-M1 recompute: refreshes `proven_gmv`/`proven_orders` in
 * bridge.px_creator_capability from creator_subcat_segment_gmv, SCOPED to the
 * creators in one ingest batch (never the whole table — see run.ts step doc).
 *
 * The heavy lifting (aggregation, zero-out of stale combos, upsert) all happens
 * in ONE Postgres function call (public.px_capability_recompute, migration 0051)
 * — that is both the non-functional requirement (5.000 kreator < 60 detik:
 * aggregation in SQL, not fetchAll+reduce in JS) AND the atomicity requirement
 * (PRD Rule 12: a failed recompute must leave old proven_* values untouched —
 * a single function call is a single implicit Postgres transaction, so any
 * exception rolls back every write it made). `slots_total` is never touched
 * here (PRD Rule 2 — it is the one human input, no second source of truth).
 *
 * bridge.px_creator_capability itself is unreachable via createAdminClient()'s
 * normal .from()/.rpc() (the `bridge` schema is deliberately NOT registered with
 * PostgREST — see migration 0051 header) — that is why this calls a `public`
 * schema wrapper RPC instead of touching the table directly.
 */
export async function recomputeCapability(
  admin: SupabaseClient,
  creatorIds: string[]
): Promise<{ rowsAffected: number }> {
  if (creatorIds.length === 0) return { rowsAffected: 0 };

  // Window = app_config projection.window_days (shared with M5/M6 — CLAUDE.md
  // #8, one implementation). loadProjectionConfig()/getConfig() throw when the
  // key is missing — that behavior is deliberately preserved, not defaulted away.
  const { windowDays } = await loadProjectionConfig();
  const cutoff = windowStart(windowDays);

  const { data, error } = await admin.rpc("px_capability_recompute", {
    p_creator_ids: creatorIds,
    p_cutoff: cutoff,
  });
  if (error) throw new Error(`px_capability_recompute gagal: ${error.message}`);
  return { rowsAffected: typeof data === "number" ? data : 0 };
}

/**
 * Wraps recomputeCapability with the try/catch + audit contract runIngest's
 * step needs (mirrors runLeakAnalysis's own step in the same file): a failure
 * here must NEVER fail/rollback the ingest batch that already committed its
 * performance aggregates — it is reported back and logged to audit_logs
 * (`px_capability_recompute_failed`), and last_computed_at staying stale is
 * what visibly signals the delay (PRD Rule 12).
 */
export async function recomputeCapabilityForBatch(
  admin: SupabaseClient,
  creatorIds: string[],
  actorId: string
): Promise<{ rows: number | null; skipped: string | null; error: string | null }> {
  if (creatorIds.length === 0) {
    return { rows: null, skipped: "Recompute kapasitas dilewati: tidak ada kreator di batch ini.", error: null };
  }
  try {
    const { rowsAffected } = await recomputeCapability(admin, creatorIds);
    return { rows: rowsAffected, skipped: null, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writeAudit({
      actorId,
      action: "px_capability_recompute_failed",
      entityType: "bridge.px_creator_capability",
      after: { creators: creatorIds.length, error: message },
      type: "auto",
    });
    return { rows: null, skipped: null, error: message };
  }
}

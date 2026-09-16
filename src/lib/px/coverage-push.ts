import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { listCoverage } from "./capability-data";

/**
 * PX-M3-A: pushes the weekly coverage snapshot to CDPS (Flow C,
 * `docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md` — committed byte-identically in
 * both `mcnapp` and `MEAgrup/AgencyAPP`; that document is the single source
 * of truth for the payload shape, not this file's comments).
 *
 * Deviation from the CDPS-side ticket (`PX_M3_BACKLOG.md`, written without
 * visibility into this repo's actual code): the ticket imagined a NEW
 * `bridge.px_coverage_export()` SQL wrapper that adds `snapshot_at` on top of
 * `bridge.px_coverage_map()`. That function is not needed — `public.px_coverage()`
 * (migration 0051, PX-M1) is ALREADY the exact passthrough this needs (same 6
 * columns, same SECURITY DEFINER path around the un-exposed `bridge` schema —
 * see migration 0051's "Layer 3" header), and `listCoverage()` is the ONE
 * place that calls it (CLAUDE.md #4 — one source of truth, no second read
 * path to the same data). `snapshot_at` is added HERE, in TypeScript, at the
 * moment the payload is actually built — that is a closer match to what the
 * contract means by "waktu payload dibuat DI MCN" than a DB-side `now()`
 * would be, and it costs zero migrations.
 *
 * Zero creator identity, ever (K-2): `listCoverage()`/`bridge.px_coverage_map()`
 * is a GROUP BY aggregate over (level2_category, price_segment) — there is no
 * creator_id column to accidentally forward. Nothing here strips a field that
 * could be forgotten; the row shape structurally cannot carry one.
 */

const BRIDGE_PATH = "/api/v1/internal/bridge/px-coverage";
/** Contract §Non-negotiables #7 — 5.000 baris per request. Coverage is bounded
 * by (kategori × segmen harga), so this is a correctness guard, not a real limit
 * expected to bind; if it ever does, the fix is CDPS-side pagination (a contract
 * change), not silent truncation here. */
const MAX_ROWS = 5000;

export interface CoveragePushResult {
  batchKey: string;
  rowsReceived: number;
  duplicate: boolean;
}

interface CoveragePushBody {
  snapshot_at: string;
  source: "mcnapp";
  policy_note: string;
  rows: Array<{
    level2_category: string;
    price_segment: string;
    creator_count: number;
    total_slots_available: number;
    total_proven_gmv: number;
    status: string;
  }>;
}

/**
 * Builds the payload and POSTs it to CDPS. Returns `{ skipped }` (never
 * throws) when a precondition for pushing isn't met — missing config, or
 * zero coverage rows (contract §Non-negotiables #7: "MCN yang punya nol
 * coverage baru sama sekali tidak perlu push"). Throws on an actual push
 * failure (network error, non-2xx response) — the caller
 * (`pushCoverageForBatch`) is what converts that into a reported, non-fatal
 * ingest-step result.
 */
export async function pushCoverageSnapshot(
  admin: SupabaseClient
): Promise<CoveragePushResult | { skipped: string }> {
  const baseUrl = process.env.CDPS_BRIDGE_URL;
  const secret = process.env.BRIDGE_PX_SECRET;
  if (!baseUrl || !secret) {
    return {
      skipped:
        "Push coverage PX dilewati: CDPS_BRIDGE_URL/BRIDGE_PX_SECRET belum diset di environment.",
    };
  }

  const rows = await listCoverage(admin, null);
  if (rows.length === 0) {
    return {
      skipped: "Push coverage PX dilewati: nol baris coverage (belum ada kapasitas kreator tercatat).",
    };
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(
      `Coverage PX punya ${rows.length} baris, melebihi batas kontrak ${MAX_ROWS} — hubungi CDPS untuk paginasi sebelum push (bukan dipotong diam-diam).`
    );
  }

  const snapshotAt = new Date().toISOString();
  const body: CoveragePushBody = {
    snapshot_at: snapshotAt,
    source: "mcnapp",
    policy_note: "aggregate-only; no creator identity (K-2)",
    rows: rows.map((r) => ({
      level2_category: r.level2_category,
      price_segment: r.price_segment,
      creator_count: Number(r.creator_count),
      total_slots_available: Number(r.total_slots_available),
      total_proven_gmv: Number(r.total_proven_gmv),
      status: r.status,
    })),
  };

  // Stable key order (object literal above is written in the SAME order every
  // call) so a genuine retry of the same snapshot hashes to the same
  // Idempotency-Key (PX_M3_BACKLOG.md M3-A ticket item 6).
  const payload = JSON.stringify(body);
  const yyyymmdd = snapshotAt.slice(0, 10).replace(/-/g, "");
  const hash12 = createHash("sha256").update(payload).digest("hex").slice(0, 12);
  const idempotencyKey = `px-coverage-${yyyymmdd}-${hash12}`;

  const res = await fetch(`${baseUrl}${BRIDGE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: payload,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CDPS bridge px-coverage gagal (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { batch_key: string; rows_received: number; duplicate: boolean };
  return { batchKey: json.batch_key, rowsReceived: json.rows_received, duplicate: json.duplicate };
}

/**
 * Ingest-pipeline wrapper (run.ts step 10) — own try/catch, own audit row,
 * NEVER fails the batch: `proven_*` is already committed by step 7's
 * recompute, so a push failure (network blip, CDPS down, bad secret) must be
 * reported, not roll back an ingest that already succeeded — same contract
 * as `recomputeCapabilityForBatch`/`runLeakAnalysis` above it in run.ts.
 */
export async function pushCoverageForBatch(
  admin: SupabaseClient,
  actorId: string
): Promise<{ result: CoveragePushResult | null; skipped: string | null; error: string | null }> {
  try {
    const outcome = await pushCoverageSnapshot(admin);
    if ("skipped" in outcome) {
      return { result: null, skipped: outcome.skipped, error: null };
    }
    await writeAudit({
      actorId,
      action: "px_coverage_pushed",
      entityType: "bridge.px_creator_capability",
      after: { batch_key: outcome.batchKey, rows_received: outcome.rowsReceived, duplicate: outcome.duplicate },
      type: "auto",
    });
    return { result: outcome, skipped: null, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writeAudit({
      actorId,
      action: "px_coverage_push_failed",
      entityType: "bridge.px_creator_capability",
      after: { error: message },
      type: "auto",
    });
    return { result: null, skipped: null, error: message };
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoverageRow } from "./coverage-export";

/**
 * Reads/shapes for PX-M1 (Tab Registry + Tab Coverage). All calls go through
 * the `public.px_capability_*`/`public.px_coverage` RPC wrappers (migration
 * 0051) — the underlying `bridge.px_creator_capability` table and
 * `bridge.px_coverage_map()` function are unreachable directly via
 * createAdminClient() because the `bridge` schema is deliberately not
 * registered with PostgREST (see migration 0051 header).
 */

export interface CapabilityRow {
  creatorId: string;
  creatorName: string | null;
  creatorUsername: string | null;
  creatorStatus: string;
  ownerCpmId: string | null;
  level2Category: string;
  priceSegment: string;
  provenGmv: number;
  provenOrders: number;
  lastComputedAt: string;
  slotsTotal: number;
  slotsCommitted: number;
  slotsAvailable: number;
  updatedAt: string;
}

/**
 * Stable row identity (creator_id, level2_category, price_segment) — the
 * table's own PK (K2). JSON, not a delimiter-joined string (same convention as
 * productRowKey in lib/m10/product-keys.ts): level2_category is free text from
 * the platform export (CLAUDE.md #7 — no normalization beyond a lowercase
 * grouping key at aggregation time), so a fixed separator character could
 * eventually collide with real data; JSON never is and decodes back exactly.
 */
export function capabilityRowKey(creatorId: string, level2Category: string, priceSegment: string): string {
  return JSON.stringify([creatorId, level2Category, priceSegment]);
}

interface CapabilityRowDb {
  creator_id: string;
  creator_name: string | null;
  creator_username: string | null;
  creator_status: string;
  owner_cpm_id: string | null;
  level2_category: string;
  price_segment: string;
  proven_gmv: number | string;
  proven_orders: number;
  last_computed_at: string;
  slots_total: number;
  slots_committed: number;
  slots_available: number;
  updated_at: string;
}

function mapRow(r: CapabilityRowDb): CapabilityRow {
  return {
    creatorId: r.creator_id,
    creatorName: r.creator_name,
    creatorUsername: r.creator_username,
    creatorStatus: r.creator_status,
    ownerCpmId: r.owner_cpm_id,
    level2Category: r.level2_category,
    priceSegment: r.price_segment,
    provenGmv: Number(r.proven_gmv ?? 0),
    provenOrders: r.proven_orders,
    lastComputedAt: r.last_computed_at,
    slotsTotal: r.slots_total,
    slotsCommitted: r.slots_committed,
    slotsAvailable: r.slots_available,
    updatedAt: r.updated_at,
  };
}

/**
 * Registry rows — `creatorIds` null/omitted = every row (Tab Registry default
 * view, capped by px_capability_list's own p_limit, mirrors the /products
 * `.limit(1000)` + "may be truncated" convention); a list = scoped read used
 * for bulk-edit "before" state and the CPM ownership gate.
 */
export async function listCapabilityRows(
  admin: SupabaseClient,
  creatorIds?: string[] | null
): Promise<CapabilityRow[]> {
  const { data, error } = await admin.rpc("px_capability_list", {
    p_creator_ids: creatorIds && creatorIds.length > 0 ? creatorIds : null,
  });
  if (error) throw new Error(`px_capability_list gagal: ${error.message}`);
  return ((data ?? []) as CapabilityRowDb[]).map(mapRow);
}

/** Row cap enforced by px_capability_list's own p_limit (default 2000) — surfaced so the page can warn. */
export const CAPABILITY_LIST_LIMIT = 2000;

// Same order of magnitude as products.ts BULK_LIMIT (200) — this table's rows are
// lighter (one smallint field to change) but the "≥50 rows in one save" non-functional
// requirement doesn't call for a materially bigger cap. Lives here (not actions.ts)
// because a "use server" file may only export async functions — see products.ts's
// own BULK_LIMIT, which for the same reason lives in lib/m10/product-keys.ts.
export const CAPABILITY_BULK_LIMIT = 200;

/** Coverage rows (bridge.px_coverage_map() passthrough) — read-only, Tab Coverage + CSV export. */
export async function listCoverage(admin: SupabaseClient, level2?: string | null): Promise<CoverageRow[]> {
  const { data, error } = await admin.rpc("px_coverage", { p_level2: level2 ?? null });
  if (error) throw new Error(`px_coverage gagal: ${error.message}`);
  return (data ?? []) as CoverageRow[];
}

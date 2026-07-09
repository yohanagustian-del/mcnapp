import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";
import { rollupCreatorStatus } from "@/lib/m4/classify";
import type { ArtifactFormat, BdShopRow, LeakArtifactCreator, LeakWeekTotals } from "./leak-artifact";

/**
 * Writers for the "Agency Leaked Generator" artifact rollup (deterministic, 0 LLM).
 * creator_link_status is recomputed on the platform using the SAME formula &
 * app_config thresholds as the M4 engine (rollupCreatorStatus + m4.bocor_* config
 * — see src/lib/m4/engine.ts §81-86 & §207). No formula duplication.
 */

/** One resolved rollup row ready to persist (creatorId already resolved from name). */
export interface ResolvedLeakRollup {
  creatorId: string;
  creatorName: string;
  gmvAffiliateTotal: number | null;
  gmvTap: number | null;
  gmvBocor: number | null;
  bdOpportunityGmv: number | null;
  directGmv: number | null;
  effectiveness: number | null;
  /** gmv_tap + gmv_bocor (GMV on partnered/ber-deal shops). */
  gmvDealTotal: number;
  /** Recomputed deterministically from thresholds (never taken from the artifact). */
  leakRatio: number | null;
  linkStatus: string;
}

/**
 * Computes the deterministic rollup (gmv_deal_total, leak_ratio, link_status) for a
 * set of artifact creators, reusing the M4 engine's threshold source + formula.
 * Bullets missing (null) are treated as 0 for the arithmetic basis so a partial file
 * still yields a status; the raw nulls are preserved separately for storage/display.
 */
export async function computeLeakRollups(
  admin: SupabaseClient,
  creators: Array<LeakArtifactCreator & { creatorId: string }>
): Promise<ResolvedLeakRollup[]> {
  // Same config keys the engine reads (src/lib/m4/engine.ts §81-86).
  const [sebagian, total] = await Promise.all([
    getConfig<number>("m4.bocor_sebagian"),
    getConfig<number>("m4.bocor_total"),
  ]);
  const thresholds = { sebagian, total };

  return creators.map((c) => {
    const gmvTap = c.gmvTap ?? 0;
    const gmvBocor = c.gmvBocor ?? 0;
    const gmvDealTotal = gmvTap + gmvBocor;
    // Reuse the engine's rollup formula (no duplication) — leak_ratio & status
    // are recomputed on the platform, not read from the artifact.
    const { leakRatio, status } = rollupCreatorStatus(gmvDealTotal, gmvBocor, thresholds);
    return {
      creatorId: c.creatorId,
      creatorName: c.creatorName,
      gmvAffiliateTotal: c.gmvAffiliateTotal,
      gmvTap: c.gmvTap,
      gmvBocor: c.gmvBocor,
      bdOpportunityGmv: c.bdOpportunityGmv,
      directGmv: c.directGmv,
      effectiveness: c.effectiveness,
      gmvDealTotal,
      leakRatio,
      linkStatus: status,
    };
  });
}

/**
 * Persists artifact rollups to creator_link_status with delete-then-insert scoped to
 * (week, ONLY the creator_ids in this file) — a different CM uploading the same week
 * for other creators must not be wiped. source='artifact', computed_at=now.
 */
export async function writeLeakRollups(
  admin: SupabaseClient,
  week: string,
  rollups: ResolvedLeakRollup[]
): Promise<void> {
  if (rollups.length === 0) return;
  const creatorIds = rollups.map((r) => r.creatorId);

  // Scoped delete: only this file's creators for this week (chunk the .in() filter).
  for (let i = 0; i < creatorIds.length; i += 200) {
    const chunk = creatorIds.slice(i, i + 200);
    const { error } = await admin
      .from("creator_link_status")
      .delete()
      .eq("week", week)
      .in("creator_id", chunk);
    if (error) throw new Error(`Gagal reset creator_link_status: ${error.message}`);
  }

  const now = new Date().toISOString();
  const rows = rollups.map((r) => ({
    creator_id: r.creatorId,
    week,
    gmv_deal_total: r.gmvDealTotal,
    gmv_bocor: r.gmvBocor ?? 0,
    leak_ratio: r.leakRatio,
    link_status: r.linkStatus,
    gmv_affiliate_total: r.gmvAffiliateTotal,
    gmv_tap: r.gmvTap,
    bd_opportunity_gmv: r.bdOpportunityGmv,
    direct_gmv: r.directGmv,
    source: "artifact",
    computed_at: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("creator_link_status").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis creator_link_status: ${error.message}`);
  }
}

/**
 * Persists format-v2 artifact rows to creator_link_status with the SAME scoped
 * delete-then-insert semantics as writeLeakRollups, but WITHOUT recomputing
 * link_status/gmv_bocor/leak_ratio/gmv_deal_total — format v2's "Ringkasan
 * Creator" sheet has no per-creator leak/TAP breakdown, so those columns are left
 * NULL (unknown, never a fabricated 0/status). Only gmv_affiliate_total is
 * populated per creator; gmv_tap/bd_opportunity_gmv/direct_gmv are also null
 * (unavailable in this format). source='artifact'.
 */
export async function writeUnknownLeakRollups(
  admin: SupabaseClient,
  week: string,
  creators: Array<LeakArtifactCreator & { creatorId: string }>
): Promise<void> {
  if (creators.length === 0) return;
  const creatorIds = creators.map((c) => c.creatorId);

  for (let i = 0; i < creatorIds.length; i += 200) {
    const chunk = creatorIds.slice(i, i + 200);
    const { error } = await admin
      .from("creator_link_status")
      .delete()
      .eq("week", week)
      .in("creator_id", chunk);
    if (error) throw new Error(`Gagal reset creator_link_status: ${error.message}`);
  }

  const now = new Date().toISOString();
  const rows = creators.map((c) => ({
    creator_id: c.creatorId,
    week,
    gmv_deal_total: null,
    gmv_bocor: null,
    leak_ratio: null,
    link_status: null,
    gmv_affiliate_total: c.gmvAffiliateTotal,
    gmv_tap: null,
    bd_opportunity_gmv: null,
    direct_gmv: null,
    source: "artifact",
    computed_at: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("creator_link_status").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis creator_link_status: ${error.message}`);
  }
}

/**
 * Upserts the CM-level weekly totals (leak_week_summary) — delete-then-insert on
 * (week, uploaded_by) so a re-upload for the same week by the same uploader
 * replaces the prior figures rather than duplicating rows. Written for BOTH
 * formats (source_format distinguishes provenance) so v1 and v2 uploads leave a
 * comparable weekly trail.
 */
export async function writeLeakWeekSummary(
  admin: SupabaseClient,
  week: string,
  periodEnd: string,
  totals: LeakWeekTotals,
  sourceFormat: ArtifactFormat,
  uploadedBy: string | null
): Promise<void> {
  // .eq() does not match NULL in PostgREST — use .is() when there is no uploader
  // (actorId absent), otherwise the delete-then-insert would silently skip reset.
  let delQuery = admin.from("leak_week_summary").delete().eq("week", week);
  delQuery = uploadedBy === null ? delQuery.is("uploaded_by", null) : delQuery.eq("uploaded_by", uploadedBy);
  const { error: delError } = await delQuery;
  if (delError) throw new Error(`Gagal reset leak_week_summary: ${delError.message}`);

  const { error: insError } = await admin.from("leak_week_summary").insert({
    week,
    period_end: periodEnd,
    gmv_affiliate_total: totals.gmvAffiliateTotal,
    gmv_tap: totals.gmvTap,
    gmv_leak_potential: totals.gmvLeakPotential,
    source_format: sourceFormat === "v1" ? "artifact_v1" : "artifact_v2",
    uploaded_by: uploadedBy,
  });
  if (insError) throw new Error(`Gagal menulis leak_week_summary: ${insError.message}`);
}

export interface BdLeadWriteResult {
  created: number;
  updated: number;
}

/**
 * Upserts BD_Shop_Summary rows into bd_leads following the M4 engine semantics
 * (src/lib/m4/engine.ts §229-278): existing leads get total_gmv/frequency refreshed
 * only (BizDev-managed status/first_seen_week/source untouched); new leads are
 * created with source='artifact', first_seen_week=periodStart, frequency=Num Creators.
 */
export async function writeBdLeadsFromArtifact(
  admin: SupabaseClient,
  periodStart: string,
  shops: BdShopRow[]
): Promise<BdLeadWriteResult> {
  if (shops.length === 0) return { created: 0, updated: 0 };

  // Collapse duplicate shop_ids (last wins) — the summary is already per-shop, but
  // guard against accidental repeats so the upsert payload has unique conflict keys.
  const byShop = new Map<string, BdShopRow>();
  for (const s of shops) byShop.set(s.shopId, s);
  const uniqueShops = [...byShop.values()];
  const shopIds = uniqueShops.map((s) => s.shopId);

  // Which shops already exist (chunk the .in() to stay under the URL limit).
  const existingSet = new Set<string>();
  for (let i = 0; i < shopIds.length; i += 200) {
    const chunk = shopIds.slice(i, i + 200);
    const { data, error } = await admin.from("bd_leads").select("shop_id").in("shop_id", chunk);
    if (error) throw new Error(`Gagal membaca bd_leads: ${error.message}`);
    for (const r of data ?? []) existingSet.add(String(r.shop_id));
  }

  const newLeads = uniqueShops
    .filter((s) => !existingSet.has(s.shopId))
    .map((s) => ({
      shop_id: s.shopId,
      shop_name: s.shopName,
      frequency: s.numCreators,
      total_gmv: s.gmvOpportunity,
      priority_score: (s.numCreators ?? 0) * (s.gmvOpportunity ?? 0),
      first_seen_week: periodStart,
      source: "artifact",
      status: "baru",
    }));
  if (newLeads.length) {
    const { error } = await admin.from("bd_leads").insert(newLeads);
    if (error) throw new Error(`Gagal menulis bd_leads baru: ${error.message}`);
  }

  // Existing leads: refresh metrics only via chunked upsert (onConflict shop_id).
  // Payload omits first_seen_week/source/status so BizDev-managed fields are kept.
  const updatedLeads = uniqueShops
    .filter((s) => existingSet.has(s.shopId))
    .map((s) => ({
      shop_id: s.shopId,
      shop_name: s.shopName,
      frequency: s.numCreators,
      total_gmv: s.gmvOpportunity,
      priority_score: (s.numCreators ?? 0) * (s.gmvOpportunity ?? 0),
    }));
  for (let i = 0; i < updatedLeads.length; i += 500) {
    const { error } = await admin
      .from("bd_leads")
      .upsert(updatedLeads.slice(i, i + 500), { onConflict: "shop_id" });
    if (error) throw new Error(`Gagal update bd_leads: ${error.message}`);
  }

  return { created: newLeads.length, updated: updatedLeads.length };
}

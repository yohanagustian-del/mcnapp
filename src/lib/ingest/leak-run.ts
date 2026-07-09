import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { resolveCreatorNames } from "@/lib/platform-csv";
import { validateW1W5Period } from "@/lib/utils/date";
import type { ArtifactFormat, LeakWeekTotals } from "./leak-artifact";
import { parseBdOpportunityFile, parseLeakDetailFile } from "./leak-artifact";
import {
  computeLeakRollups,
  writeBdLeadsFromArtifact,
  writeLeakRollups,
  writeLeakWeekSummary,
  writeUnknownLeakRollups,
  type ResolvedLeakRollup,
} from "./leak-rollup";
import { enforceLeakRetention } from "./run";

export interface UploadLeakArtifactInput {
  /** File 1 — Leak Detail Report (required). */
  leakFile: File;
  /** File 2 — BD Opportunity Report (optional). */
  bdFile?: File | null;
  actorId: string;
}

export interface LeakArtifactCreatorResult {
  creatorName: string;
  creatorId: string;
  /**
   * Null only for format v2 (source report has no per-creator leak breakdown —
   * unknown, not "belum_ada_link"). Format v1 always fills this.
   */
  linkStatus: string | null;
  leakRatio: number | null;
  gmvBocor: number | null;
  gmvAffiliateTotal: number | null;
  gmvTap: number | null;
  effectiveness: number | null;
  createdProspect: boolean;
}

export interface UploadLeakArtifactResult {
  /** Which artifact export format was detected for File 1. */
  format: ArtifactFormat;
  periodStart: string;
  periodEnd: string;
  /** = period_start (creator_link_status.week key). */
  week: string;
  creators: LeakArtifactCreatorResult[];
  /** CM-level totals — present for both formats (v1: summed from bullets; v2: read directly). */
  weekTotals: LeakWeekTotals;
  bdShopsNew: number;
  bdShopsUpdated: number;
  skipped: string[];
}

/** Sums a per-creator numeric field, treating null as 0 (v1 has a value for every creator). */
function sumField(rollups: ResolvedLeakRollup[], key: "gmvAffiliateTotal" | "gmvTap"): number {
  return rollups.reduce((acc, r) => acc + (r[key] ?? 0), 0);
}

/**
 * Orchestrates the weekly "Agency Leaked Generator" artifact upload (Module 0.5
 * follow-up): parse File 1 (+ optional File 2), reject non-W1-W5 periods, resolve
 * creator names, then ROUTE BY DETECTED FORMAT:
 *   - v1: recompute the leak rollup deterministically (same M4 formula & app_config
 *     thresholds) and persist full creator_link_status rows.
 *   - v2: persist creator_link_status rows with gmv_affiliate_total only —
 *     link_status/gmv_bocor/leak_ratio/gmv_deal_total are unknown (null), never
 *     fabricated — plus the CM-level totals into leak_week_summary.
 * File 2 (BD leads) and retention cleanup are format-agnostic (unchanged). 0 LLM.
 *
 * Best-effort ordering (Supabase JS has no cross-table transaction). This does NOT
 * touch runIngest's aggregate pipeline — it is an additive second upload path.
 */
export async function uploadLeakArtifact(
  input: UploadLeakArtifactInput
): Promise<UploadLeakArtifactResult> {
  const admin = createAdminClient();
  const { leakFile, bdFile, actorId } = input;

  // ---- 1. Parse File 1 (auto-detect format v1/v2; period + per-creator data) ----
  const detail = await parseLeakDetailFile(leakFile);
  const skipped: string[] = [...detail.skipped];

  // ---- W1-W5 gate (reject before any write) — same rule for both formats ----
  const scheme = validateW1W5Period(detail.periodStart, detail.periodEnd);
  if (!scheme.valid) {
    throw new Error(
      `${scheme.reason ?? "Periode artifak tidak sesuai skema W1-W5."} ` +
        "Jalankan artifak Agency Leaked Generator dengan rentang tanggal W1-W5 (satu window, tidak menyebrang bulan)."
    );
  }
  const week = detail.periodStart;

  // ---- 2. Resolve creator usernames → creators.id (auto-create prospek) ----
  // A creator in a CM leak report is by definition already joined with MEA → "aktif".
  const names = detail.creators.map((c) => c.creatorName).filter((n) => n.trim() !== "");
  const { byName, createdProspects } = await resolveCreatorNames(admin, names, actorId, "aktif");
  const createdSet = new Set(createdProspects.map((n) => n.toLowerCase()));

  const resolvable: Array<(typeof detail.creators)[number] & { creatorId: string }> = [];
  for (const c of detail.creators) {
    const id = c.creatorName.trim() ? byName.get(c.creatorName.toLowerCase()) : undefined;
    if (!id) {
      skipped.push(`Creator "${c.creatorName || "(kosong)"}" tidak dapat di-resolve → dilewati.`);
      continue;
    }
    resolvable.push({ ...c, creatorId: id });
  }

  // ---- 3. Persist per-creator rows — routed by detected format ----
  let creators: LeakArtifactCreatorResult[];
  let weekTotals: LeakWeekTotals;

  if (detail.format === "v1") {
    const rollups: ResolvedLeakRollup[] = await computeLeakRollups(admin, resolvable);
    await writeLeakRollups(admin, week, rollups);
    creators = rollups.map((r) => ({
      creatorName: r.creatorName,
      creatorId: r.creatorId,
      linkStatus: r.linkStatus,
      leakRatio: r.leakRatio,
      gmvBocor: r.gmvBocor,
      gmvAffiliateTotal: r.gmvAffiliateTotal,
      gmvTap: r.gmvTap,
      effectiveness: r.effectiveness,
      createdProspect: createdSet.has(r.creatorName.toLowerCase()),
    }));
    // v1 has no CM-level totals in the source — derive them by summing the
    // per-creator bullets so both formats leave a comparable weekly trail.
    weekTotals = {
      gmvAffiliateTotal: sumField(rollups, "gmvAffiliateTotal"),
      gmvTap: sumField(rollups, "gmvTap"),
      gmvLeakPotential: rollups.reduce((acc, r) => acc + (r.gmvBocor ?? 0), 0),
    };
  } else {
    // v2: no per-creator leak breakdown available — status/bocor/ratio/deal_total
    // stay null (unknown, not zero/belum_ada_link). Only gmv_affiliate_total is real.
    await writeUnknownLeakRollups(admin, week, resolvable);
    skipped.push(
      "Format artifak baru (v2) tidak memiliki rincian bocor per kreator — status link, % bocor, dan GMV TAP per kreator TIDAK TERSEDIA (unknown, bukan nol). Hanya Total Affiliate GMV per kreator yang tersimpan; totals level-CM tersimpan terpisah."
    );
    creators = resolvable.map((c) => ({
      creatorName: c.creatorName,
      creatorId: c.creatorId,
      linkStatus: null,
      leakRatio: null,
      gmvBocor: null,
      gmvAffiliateTotal: c.gmvAffiliateTotal,
      gmvTap: null,
      effectiveness: null,
      createdProspect: createdSet.has(c.creatorName.toLowerCase()),
    }));
    weekTotals = detail.weekTotals ?? { gmvAffiliateTotal: null, gmvTap: null, gmvLeakPotential: null };
  }

  await writeLeakWeekSummary(admin, week, detail.periodEnd, weekTotals, detail.format, actorId || null);

  // ---- 4. BD leads from File 2 (optional, format-agnostic) ----
  let bdShopsNew = 0;
  let bdShopsUpdated = 0;
  if (bdFile) {
    const bd = await parseBdOpportunityFile(bdFile);
    skipped.push(...bd.skipped);
    const res = await writeBdLeadsFromArtifact(admin, week, bd.shops);
    bdShopsNew = res.created;
    bdShopsUpdated = res.updated;
  }

  // ---- 5. Retention cleanup (deterministic, app_config windows) ----
  await enforceLeakRetention(admin, week);

  // ---- 6. Audit (type auto — storing external analysis, not a risk-bearing action) ----
  await writeAudit({
    actorId,
    action: "leak_artifact.upload",
    entityType: "creator_link_status",
    entityId: week,
    after: {
      format: detail.format,
      period: { start: detail.periodStart, end: detail.periodEnd },
      creators_count: creators.length,
      bd_shops_count: bdShopsNew + bdShopsUpdated,
      week_totals: weekTotals,
      creators: creators.map((c) => ({
        creator_id: c.creatorId,
        link_status: c.linkStatus,
        leak_ratio: c.leakRatio,
      })),
    },
    type: "auto",
  });

  return {
    format: detail.format,
    periodStart: detail.periodStart,
    periodEnd: detail.periodEnd,
    week,
    creators,
    weekTotals,
    bdShopsNew,
    bdShopsUpdated,
    skipped,
  };
}

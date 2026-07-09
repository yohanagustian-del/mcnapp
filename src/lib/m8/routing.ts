/**
 * M8 Team Workspaces — pure rule-based logic (PRD Module 08). 0 token AI.
 *
 * Campaign request routing state machine (§2E):
 *   diajukan BizDev → di CM (menunggu konfirmasi) → creator mau/tidak
 *   → [menunggu acc brand bila perlu] → fix/batal.
 * Every transition is validated here; persistence + audit happen in the
 * server actions. M8 surfaces M2/M4/M5/M6 outputs — it never recomputes them.
 */

export type CmConfirm = "menunggu" | "mau" | "tidak";
export type BrandAcc = "n_a" | "menunggu" | "approved" | "ditolak";
export type FinalStatus = "proses" | "fix" | "batal";

export interface CampaignReqState {
  cm_confirm_status: CmConfirm;
  needs_brand_acc: boolean;
  brand_acc_status: BrandAcc;
  final_status: FinalStatus;
}

/** New request as routed by BizDev: waits for the owning CM first (§2E.1 step 3). */
export function initialRequestState(needsBrandAcc: boolean): CampaignReqState {
  return {
    cm_confirm_status: "menunggu",
    needs_brand_acc: needsBrandAcc,
    brand_acc_status: "n_a", // brand gate only opens after the creator says yes
    final_status: "proses",
  };
}

/** CM confirms whether the creator wants to join (§2E.1 step 3). */
export function applyCmConfirm(
  state: CampaignReqState,
  decision: "mau" | "tidak"
): CampaignReqState {
  if (state.final_status !== "proses") {
    throw new Error(`Req sudah ${state.final_status} — konfirmasi CM tidak berlaku lagi`);
  }
  if (state.cm_confirm_status !== "menunggu") {
    throw new Error(`Konfirmasi CM sudah tercatat (${state.cm_confirm_status})`);
  }
  if (decision === "tidak") {
    return { ...state, cm_confirm_status: "tidak", final_status: "batal" };
  }
  return state.needs_brand_acc
    ? { ...state, cm_confirm_status: "mau", brand_acc_status: "menunggu" }
    : { ...state, cm_confirm_status: "mau", final_status: "fix" };
}

/** Brand approves/rejects the creator (§2E.1 step 4 — only when the campaign needs it). */
export function applyBrandAcc(
  state: CampaignReqState,
  decision: "approved" | "ditolak"
): CampaignReqState {
  if (state.final_status !== "proses") {
    throw new Error(`Req sudah ${state.final_status} — acc brand tidak berlaku lagi`);
  }
  if (!state.needs_brand_acc || state.brand_acc_status !== "menunggu") {
    throw new Error("Req tidak sedang menunggu acc brand");
  }
  return decision === "approved"
    ? { ...state, brand_acc_status: "approved", final_status: "fix" }
    : { ...state, brand_acc_status: "ditolak", final_status: "batal" };
}

/** Handover to Campaign Ops is only valid once the request is fix (§2E.1 step 5). */
export function canHandover(state: CampaignReqState): boolean {
  return state.final_status === "fix";
}

// ============ CM Workspace helpers ============

/**
 * Performance-drop alert (§2A.2, LOCKED §6.1): GMV down more than `threshold`
 * week-over-week → alert to the CPM (event, never an approval).
 */
export function isPerfDrop(
  currentGmv: number,
  previousGmv: number,
  threshold: number
): boolean {
  if (previousGmv <= 0) return false; // no basis — first week is not a drop
  return (previousGmv - currentGmv) / previousGmv > threshold;
}

/**
 * Ads request vs the creator's ads budget cap (§2A.4, LOCKED §6.4): over cap —
 * or unverifiable (no cap / no amount) — needs Director approval (CLAUDE.md #2).
 */
export function adsNeedsDirectorApproval(
  amount: number | null,
  adsBudgetCap: number | null
): boolean {
  if (amount === null || adsBudgetCap === null) return true;
  return amount > adsBudgetCap;
}

/**
 * Growth mingguan per creator (§2A.2) dari creator_period_summary (Module 0.5
 * Fase 2 — menggantikan hitung per-hari dari platform_metrics_raw, bug yang
 * membuat "1 hari" tampil sebagai "1 minggu"). A period can have more than one
 * upload_batch (re-upload/correction) — this keeps only the LATEST batch (by
 * created_at) per distinct period_start, then compares the two most recent
 * periods for the growth column + the perf-drop alert scan.
 */
export interface PeriodSummaryPoint {
  periodStart: string;
  periodEnd: string;
  uploadBatch: string;
  affiliateGmv: number;
  createdAt: string;
}

export interface GrowthPoint {
  current: number;
  previous: number | null;
  periodStart: string;
  periodEnd: string;
}

/**
 * Dedupe rows to one per period_start (latest upload_batch by created_at wins),
 * sort by period_start desc, and return the current/previous data points.
 */
export function latestTwoPeriods(rows: PeriodSummaryPoint[]): GrowthPoint | null {
  const latestByPeriod = new Map<string, PeriodSummaryPoint>();
  for (const row of rows) {
    const existing = latestByPeriod.get(row.periodStart);
    if (!existing || row.createdAt > existing.createdAt) {
      latestByPeriod.set(row.periodStart, row);
    }
  }
  const sorted = [...latestByPeriod.values()].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  if (sorted.length === 0) return null;
  return {
    current: sorted[0].affiliateGmv,
    previous: sorted.length > 1 ? sorted[1].affiliateGmv : null,
    periodStart: sorted[0].periodStart,
    periodEnd: sorted[0].periodEnd,
  };
}

// ============ BizDev Workspace helpers ============

export const PIPELINE_STAGES = ["prospek", "nego", "closing", "aktif", "selesai"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * Upgrade-service recommendation (§2B.4, LOCKED §6.5): high ROAS + high GMV.
 * ROAS needs ads spend; without it there is no basis → no recommendation.
 */
export function shouldRecommendUpgrade(
  gmv: number,
  roas: number | null,
  cfg: { roasMin: number; gmvMin: number }
): boolean {
  return roas !== null && roas >= cfg.roasMin && gmv >= cfg.gmvMin;
}

// ============ External Workspace helpers ============

/** Success rate = deal pakai link TAP / total approach (§2D.1). Null when no basis. */
export function successRate(totalApproach: number, totalSuccess: number): number | null {
  if (totalApproach <= 0) return null;
  return totalSuccess / totalApproach;
}

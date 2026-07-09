/**
 * M10 Campaign & Ads Support — pure rule-based logic (PRD Module 10). 0 token AI.
 *
 * Bridge: brief → execution → result. ads_spent is the SINGLE source of ads spend, reused by
 * M7 (project profitability) and M8 (cap check) — never re-entered. GMV live-ads is a distinct
 * context from M2 platform GMV and must not be double-counted in brand reports.
 */

export type BriefStatus = "baru" | "menunggu_approval" | "dikerjakan" | "selesai" | "batal";
export const DEFAULT_ROAS_TOL = 0.05;

// ---------- ROAS cross-check (mirrors the SQL trigger) ----------

export interface RoasCheck {
  computed: number | null;
  flagged: boolean;
}

/**
 * roas ≈ gmv/ads_spent. Flags (review, NOT block) when the manual roas diverges beyond the
 * configurable tolerance. Relative to the larger of the two values so it is symmetric.
 */
export function roasCrosscheck(
  gmv: number,
  adsSpent: number,
  roas: number | null,
  tol: number = DEFAULT_ROAS_TOL,
): RoasCheck {
  if (!(adsSpent > 0) || roas == null) return { computed: null, flagged: false };
  const computed = gmv / adsSpent;
  const flagged = Math.abs(computed - roas) > Math.max(computed, roas) * tol;
  return { computed, flagged };
}

// ---------- Budget cap enforcement at brief intake (reuse M8 §2A.4 semantics) ----------

/**
 * A brief whose requested budget exceeds the deal/creator ads_budget_cap needs Director
 * approval before work starts. Unverifiable cases (no cap, or no budget) are conservative:
 * an over-request with an unknown cap still routes to approval.
 */
export function briefNeedsApproval(budgetRequested: number | null, cap: number | null): boolean {
  if (budgetRequested == null) return false; // nothing requested yet
  if (cap == null) return true; // cannot verify against a cap → gate
  return budgetRequested > cap;
}

/** Initial status at intake: over-cap → menunggu_approval (Director gate), else baru. */
export function initialBriefStatus(budgetRequested: number | null, cap: number | null): BriefStatus {
  return briefNeedsApproval(budgetRequested, cap) ? "menunggu_approval" : "baru";
}

// ---------- Brief priority (tunable via m10.brief_priority) ----------

export interface PriorityWeights {
  deadline_weight: number;
  budget_weight: number;
}
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { deadline_weight: 0.6, budget_weight: 0.4 };

/**
 * Higher score = work sooner. Nearer deadlines and larger budgets rank up. `daysToDeadline`
 * is clamped at 0 (overdue) and normalized so sooner → higher.
 */
export function briefPriority(
  daysToDeadline: number,
  budget: number,
  maxBudget: number,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): number {
  const urgency = 1 / (1 + Math.max(0, daysToDeadline)); // 1 when due today, →0 far out
  const budgetScore = maxBudget > 0 ? Math.min(1, budget / maxBudget) : 0;
  return weights.deadline_weight * urgency + weights.budget_weight * budgetScore;
}

// ---------- Single-source ads spend adapter (feed to M7) ----------

export interface AdsResultRow {
  brief_id: number;
  period: string; // YYYY-MM-DD
  ads_spent: number;
}
export interface BriefRow {
  id: number;
  project_id: number | null;
}

/**
 * Aggregate ads_spent per (project_id, period) from ads_campaign_results — the ONLY input of
 * ads spend into M7. Because (brief_id, period) is unique upstream, each spend row is counted
 * exactly once; M7 must read this instead of prompting for ads spend again (no double input).
 */
export function aggregateProjectAdsSpend(
  results: AdsResultRow[],
  briefs: BriefRow[],
): { project_id: number; date: string; ads_spend: number }[] {
  const projectByBrief = new Map(briefs.map((b) => [b.id, b.project_id]));
  const acc = new Map<string, number>();
  for (const r of results) {
    const pid = projectByBrief.get(r.brief_id);
    if (pid == null) continue; // brief not tied to a project → not a project ads spend
    const key = `${pid}|${r.period}`;
    acc.set(key, (acc.get(key) ?? 0) + r.ads_spent);
  }
  return [...acc.entries()].map(([key, ads_spend]) => {
    const [pid, date] = key.split("|");
    return { project_id: Number(pid), date, ads_spend };
  });
}

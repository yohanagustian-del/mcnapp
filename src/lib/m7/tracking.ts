/**
 * M7 Special Project — pure tracking & profitability rules (PRD Module 07
 * §2.2 & §2.4). Deterministic only: curves, cumulative sums, run-rate, margin.
 * NO LLM anywhere (the optional end-of-project narrative lives elsewhere).
 */

export type CurveShape = "ramp" | "flat";
export type TrackStatus = "on_track" | "behind" | "ahead";

/**
 * Cumulative daily targets. PRD §2.2 (LOCKED): default curve = ramp-up — daily
 * weight grows linearly (day i weight ∝ i), acknowledging that big achievements
 * cluster late (campaign peaks); a reference, not a rigid daily quota.
 */
export function cumulativeTargets(targetGmv: number, days: number, shape: CurveShape = "ramp"): number[] {
  if (days <= 0) return [];
  const weights = Array.from({ length: days }, (_, i) => (shape === "ramp" ? i + 1 : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  const out: number[] = [];
  let cum = 0;
  for (const w of weights) {
    cum += (targetGmv * w) / total;
    out.push(cum);
  }
  // guard rounding drift: last point is exactly the target
  out[days - 1] = targetGmv;
  return out;
}

export interface DailyActual {
  date: string; // ISO
  gmv: number;
}

export interface TrackingPoint {
  date: string;
  dayIndex: number; // 1-based
  gmvActual: number;
  cumActual: number;
  cumTarget: number;
  gap: number; // cumActual − cumTarget
}

export interface TrackingSummary {
  points: TrackingPoint[];
  daysElapsed: number;
  totalDays: number;
  cumActual: number;
  cumTarget: number;
  gap: number;
  /** Run-rate projection to project end: cumActual / daysElapsed × totalDays. */
  runRateProjection: number;
  status: TrackStatus;
  achievementPct: number; // cumActual / targetGmv
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * trackDaily (PRD §2.2): daily actuals vs the cumulative ramp-up curve →
 * progress, gap, run-rate projection, and on-track/behind/ahead status.
 * `tolerance` (app_config m7.status_tolerance) is the ± band around the
 * cumulative target within which the project still counts as on-track.
 */
export function trackDaily(
  actuals: DailyActual[],
  startDate: string,
  endDate: string,
  targetGmv: number,
  tolerance: number,
  shape: CurveShape = "ramp",
  asOf?: string
): TrackingSummary {
  const totalDays = dayDiff(startDate, endDate) + 1;
  const targets = cumulativeTargets(targetGmv, Math.max(totalDays, 1), shape);

  const byDate = new Map<string, number>();
  for (const a of actuals) byDate.set(a.date, (byDate.get(a.date) ?? 0) + a.gmv);
  const dates = [...byDate.keys()].sort();

  const lastData = dates[dates.length - 1];
  const asOfDate = asOf ?? lastData ?? startDate;
  const daysElapsed = Math.min(Math.max(dayDiff(startDate, asOfDate) + 1, 1), Math.max(totalDays, 1));

  const points: TrackingPoint[] = [];
  let cum = 0;
  for (const date of dates) {
    const idx = dayDiff(startDate, date) + 1;
    if (idx < 1 || idx > totalDays) continue; // outside project period
    cum += byDate.get(date)!;
    points.push({
      date,
      dayIndex: idx,
      gmvActual: byDate.get(date)!,
      cumActual: cum,
      cumTarget: targets[idx - 1],
      gap: cum - targets[idx - 1],
    });
  }

  const cumActual = points.length ? points[points.length - 1].cumActual : 0;
  const cumTarget = targets[daysElapsed - 1] ?? 0;
  const gap = cumActual - cumTarget;
  const runRateProjection = daysElapsed > 0 ? (cumActual / daysElapsed) * totalDays : 0;

  let status: TrackStatus = "on_track";
  if (cumTarget > 0) {
    const ratio = cumActual / cumTarget;
    if (ratio < 1 - tolerance) status = "behind";
    else if (ratio > 1 + tolerance) status = "ahead";
  }

  return {
    points,
    daysElapsed,
    totalDays,
    cumActual,
    cumTarget,
    gap,
    runRateProjection,
    status,
    achievementPct: targetGmv > 0 ? cumActual / targetGmv : 0,
  };
}

export interface ProfitabilityInput {
  cumAdsSpend: number;
  cumMeaRevenue: number;
  adsBudgetCap: number | null;
}

export interface ProfitabilityCheck {
  margin: number; // mea_revenue − ads_spend (biaya lain belum dicatat di v1)
  /** LOCKED §2.4: rugi bila ads spend > 100% komisi/revenue MEA (bukan vs GMV creator). */
  rugi: boolean;
  overCap: boolean;
}

/** checkProfitability (PRD §2.4): margin + alert anti-rugi + ads cap guard. */
export function checkProfitability(input: ProfitabilityInput): ProfitabilityCheck {
  return {
    margin: input.cumMeaRevenue - input.cumAdsSpend,
    rugi: input.cumAdsSpend > input.cumMeaRevenue,
    overCap: input.adsBudgetCap !== null && input.cumAdsSpend > input.adsBudgetCap,
  };
}

export interface LiveActivityRow {
  creator_id: string;
  metric: string;
  value: number | null;
}

/**
 * filterLiveActive (PRD §2.3, LOCKED): creators whose live GMV over the recent
 * window meets app_config m7.live_active_min (default 65jt/bulan, tunable).
 * Returns creatorId → live GMV for those at/above the threshold.
 */
export function filterLiveActive(rows: LiveActivityRow[], minLiveGmv: number): Map<string, number> {
  const liveByCreator = new Map<string, number>();
  for (const r of rows) {
    if (r.metric !== "affiliate_live_gmv" || r.value === null) continue;
    liveByCreator.set(r.creator_id, (liveByCreator.get(r.creator_id) ?? 0) + Number(r.value));
  }
  const out = new Map<string, number>();
  for (const [id, gmv] of liveByCreator) if (gmv >= minLiveGmv) out.set(id, gmv);
  return out;
}

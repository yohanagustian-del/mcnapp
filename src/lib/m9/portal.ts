/**
 * M9 Creator Portal — pure rule-based logic (PRD Module 09). 0 token AI.
 *
 * The portal is a presentation + intake layer: it never recomputes GMV/performance
 * (those come from M2) or commissions (M8 BizDev). These helpers back the deterministic
 * guards enforced in the server actions and mirrored by SQL (RLS + triggers):
 *   - report self-service credit: 1/creator/week, expires (no accumulation)
 *   - complaint immutability: CPM may close, never edit body/creator/severity/category
 *   - CPM health dual-signal: coverage (M2) + complaints incl. status=selesai (M9)
 *   - agency-plan strip: komisi_mea/margin never surfaced to a creator
 */

export type Severity = "rendah" | "sedang" | "tinggi";
export type ComplaintStatus = "baru" | "dalam-penyelesaian" | "selesai";

export const DEFAULT_SEVERITY_WEIGHTS: Record<Severity, number> = {
  rendah: 1,
  sedang: 2,
  tinggi: 3,
};

// ---------- Report self-service credit (1/creator/week, expires) ----------

/**
 * Monday (UTC) of the ISO week containing `date` — the credit window key.
 * Matches creator_report_credits.week_start so the unique(creator_id, week_start)
 * constraint yields exactly one credit per creator per week.
 */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Credit is available only if none was used in the current week. The quota does not
 * accumulate: an unused prior week grants nothing extra. `usedWeekStarts` is the set of
 * week_start values already recorded for this creator.
 */
export function hasReportCredit(now: Date, usedWeekStarts: Iterable<string>): boolean {
  const current = weekStart(now);
  for (const w of usedWeekStarts) if (w === current) return false;
  return true;
}

/** Next Monday when a fresh credit becomes available (for the "tersedia lagi [tanggal]" hint). */
export function nextCreditDate(now: Date): string {
  const monday = new Date(`${weekStart(now)}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return monday.toISOString().slice(0, 10);
}

// ---------- Complaint immutability guard (mirrors SQL trigger) ----------

export interface ComplaintCore {
  body: string;
  creator_id: string;
  severity: Severity;
  category: string;
}

const IMMUTABLE_FIELDS: (keyof ComplaintCore)[] = ["body", "creator_id", "severity", "category"];

/** Returns the immutable fields a proposed update would change (empty = allowed). */
export function immutableViolations(prev: ComplaintCore, next: ComplaintCore): (keyof ComplaintCore)[] {
  return IMMUTABLE_FIELDS.filter((f) => prev[f] !== next[f]);
}

/** CPM close: only status + closed_at/closed_by may move; body/severity/etc. must not. */
export function assertComplaintMutationAllowed(prev: ComplaintCore, next: ComplaintCore): void {
  const bad = immutableViolations(prev, next);
  if (bad.length > 0) {
    throw new Error(`komplain immutable: tidak boleh ubah ${bad.join(", ")}`);
  }
}

// ---------- CPM health aggregation (dual-signal) ----------

export interface ComplaintRow {
  target_cpm_id: string;
  creator_id: string;
  severity: Severity;
  status: ComplaintStatus;
}

export interface CpmComplaintSignal {
  complaintCount: number;
  weightedSeverity: number;
  repeatCreators: number; // creators with >1 complaint against this CPM
}

/**
 * Aggregate complaints for one CPM. Closing a complaint does NOT reduce weight — ALL
 * complaints (including status='selesai') count, so a CPM cannot bury a pattern by
 * closing fast. Repeat-rate = creators who complained more than once.
 */
export function aggregateComplaints(
  rows: ComplaintRow[],
  weights: Record<Severity, number> = DEFAULT_SEVERITY_WEIGHTS,
): CpmComplaintSignal {
  const perCreator = new Map<string, number>();
  let weightedSeverity = 0;
  for (const r of rows) {
    weightedSeverity += weights[r.severity] ?? 0;
    perCreator.set(r.creator_id, (perCreator.get(r.creator_id) ?? 0) + 1);
  }
  let repeatCreators = 0;
  for (const count of perCreator.values()) if (count > 1) repeatCreators += 1;
  return { complaintCount: rows.length, weightedSeverity, repeatCreators };
}

// ---------- Agency plan strip (komisi_mea never surfaced) ----------

/** Columns a creator may ever see for an agency plan item. komisi_mea/margin excluded. */
export const CREATOR_PLAN_FIELDS = [
  "deal_id",
  "product_id",
  "product_name",
  "link",
  "niche",
  "komisi_kreator",
  "exp_date",
  "status",
] as const;

const FORBIDDEN_PLAN_FIELDS = ["komisi_mea", "komisi_mea_pct", "margin", "service_fee", "ads_budget", "notes"];

/** Defensive strip: drop any forbidden key before a plan object reaches a creator. */
export function stripPlanForCreator<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(row) as (keyof T)[]) {
    if (!FORBIDDEN_PLAN_FIELDS.includes(String(key))) out[key] = row[key];
  }
  return out;
}

export function planExposesForbiddenField(row: Record<string, unknown>): boolean {
  return Object.keys(row).some((k) => FORBIDDEN_PLAN_FIELDS.includes(k));
}

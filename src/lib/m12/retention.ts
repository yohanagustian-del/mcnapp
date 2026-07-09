/**
 * M12 Data Retention & Maintenance — pure rule-based logic (PRD Module 12). 0 token AI.
 *
 * Two-stage model: (1) raw upload files deleted right after ingest; (2) recorded data pruned
 * after raw_window (6 months), aggregate-first. Hard guards: never prune inside the 28-day
 * module window (M5/M6), and never touch identity/deal/agency_links/audit tables.
 * These mirror the SQL functions validate_retention_window / run_retention_purge.
 */

export const MIN_WINDOW_DAYS = 28; // M5/M6 projection window (hard floor)

/** Tables retention may prune. Anything not here is PROTECTED (never auto-purged). */
export const PURGEABLE_TABLES = ["platform_metrics_raw", "transactions_all", "transactions_agency_link"] as const;

/** Identity/deal/commercial/audit tables that a purge must NEVER touch. */
export const PROTECTED_TABLES = [
  "creators", "team_members", "creator_users", "brand_deals", "agency_links",
  "cooperating_shops", "audit_logs", "metrics_monthly_agg",
] as const;

export function isPurgeable(table: string): boolean {
  return (PURGEABLE_TABLES as readonly string[]).includes(table);
}
export function isProtected(table: string): boolean {
  return (PROTECTED_TABLES as readonly string[]).includes(table);
}

// ---------- Config validation (mirrors validate_retention_window) ----------

export function isWindowValid(days: number, minDays: number = MIN_WINDOW_DAYS): boolean {
  return days >= minDays;
}

/** Rejects a too-short retention window with a message suggesting the minimum. */
export function assertWindowValid(days: number, minDays: number = MIN_WINDOW_DAYS): void {
  if (!isWindowValid(days, minDays)) {
    throw new Error(`raw_window (${days} hari) < minimum module (${minDays} hari). Ditolak — set minimal ${minDays} hari.`);
  }
}

// ---------- Cutoff + window guard (mirrors run_retention_purge) ----------

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Cutoff = start of month `windowMonths` before now. Rows strictly older than this may prune. */
export function retentionCutoff(now: Date, windowMonths: number): string {
  const som = startOfMonth(now);
  som.setUTCMonth(som.getUTCMonth() - windowMonths);
  return som.toISOString().slice(0, 10);
}

/** True when the cutoff falls inside the protected 28-day module window → purge must abort. */
export function cutoffInsideModuleWindow(cutoff: string, now: Date, minDays: number = MIN_WINDOW_DAYS): boolean {
  const floor = new Date(now.getTime() - minDays * 24 * 60 * 60 * 1000);
  return new Date(`${cutoff}T00:00:00Z`) > new Date(floor.toISOString().slice(0, 10) + "T00:00:00Z");
}

// ---------- Aggregate-then-purge decision ----------

/**
 * A recorded row is purgeable only when it is older than the cutoff AND its month is already
 * captured in metrics_monthly_agg (aggregate-first — never lose a period that wasn't rolled up).
 */
export function shouldPurgeRow(rowPeriod: string, cutoff: string, monthAggregated: boolean): boolean {
  return rowPeriod < cutoff && monthAggregated;
}

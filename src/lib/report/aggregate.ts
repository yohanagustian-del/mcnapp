/**
 * M2 Report — deterministic data layer (PRD Module 02 §2.2–2.4).
 * Everything here is pure computation: aggregation, derived metrics, deltas,
 * and the skip-LLM gate. NO LLM in this module — the insight layer is separate.
 */
import { daysInMonth } from "@/lib/utils/date";

export type PeriodType = "weekly" | "monthly" | "custom";

export interface MetricTotals {
  gmv: number;
  live_gmv: number;
  video_gmv: number;
  orders: number;
  video_views: number;
  live_views: number;
  live_streams: number;
  videos: number;
}

export interface DerivedMetrics extends MetricTotals {
  views: number;             // video + live views
  aov: number | null;        // gmv / orders
  gpm: number | null;        // gmv per 1000 views
  conversion: number | null; // orders / views (funnel view→order)
  live_share: number | null; // live_gmv / gmv (tren live)
}

export interface RawMetricRow {
  metric: string;
  value: number | null;
  source: string | null;
  sub_category: string | null;
}

/** One creator_period_summary row (Module 0.5 §2.3 — source of truth for M2 totals). */
export interface PeriodSummaryRow {
  gmv_total: number | null;
  affiliate_gmv: number | null;
  affiliate_live_gmv: number | null;
  affiliate_video_gmv: number | null;
  orders: number | null;
}

/** One creator_top_products row (Module 0.5 §2.3 — replaces sub_category breakdown rows). */
export interface TopProductRow {
  level2_category: string | null;
  gmv: number | null;
}

const EMPTY: MetricTotals = {
  gmv: 0, live_gmv: 0, video_gmv: 0, orders: 0,
  video_views: 0, live_views: 0, live_streams: 0, videos: 0,
};

const METRIC_MAP: Record<string, keyof MetricTotals> = {
  affiliate_gmv: "gmv",
  affiliate_live_gmv: "live_gmv",
  affiliate_video_gmv: "video_gmv",
  affiliate_orders: "orders",
  video_views: "video_views",
  live_views: "live_views",
  live_streams: "live_streams",
  videos: "videos",
};

/** Sums the long-format platform_metrics_raw rows (total rows only, sub_category null). */
export function sumMetrics(rows: RawMetricRow[]): MetricTotals {
  const t = { ...EMPTY };
  for (const row of rows) {
    if (row.sub_category !== null) continue; // sub-category rows are a breakdown, not additive
    const key = METRIC_MAP[row.metric];
    if (key && row.value !== null) t[key] += Number(row.value);
  }
  return t;
}

/**
 * Totals from ONE creator_period_summary row (Module 0.5 Fase 2 — replaces
 * summing platform_metrics_raw per-day rows; report generation no longer needs
 * a fresh upload since this reads the already-aggregated period). video_views/
 * live_views/live_streams/videos have no equivalent column in the aggregate
 * table (platform custom report doesn't carry them per-period) — they stay 0,
 * same as an empty sumMetrics([]) result, so downstream views/gpm/conversion
 * degrade to null exactly like the "no data" case already handled below.
 */
export function totalsFromPeriodSummary(row: PeriodSummaryRow | null): MetricTotals {
  if (!row) return { ...EMPTY };
  return {
    ...EMPTY,
    gmv: Number(row.affiliate_gmv ?? row.gmv_total ?? 0),
    live_gmv: Number(row.affiliate_live_gmv ?? 0),
    video_gmv: Number(row.affiliate_video_gmv ?? 0),
    orders: Number(row.orders ?? 0),
  };
}

export function deriveMetrics(t: MetricTotals): DerivedMetrics {
  const views = t.video_views + t.live_views;
  return {
    ...t,
    views,
    aov: t.orders > 0 ? t.gmv / t.orders : null,
    gpm: views > 0 ? (t.gmv / views) * 1000 : null,
    conversion: views > 0 ? t.orders / views : null,
    live_share: t.gmv > 0 ? t.live_gmv / t.gmv : null,
  };
}

/** Relative delta (fraction); null when there is no previous basis. */
export function computeDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

/** GMV per source (tap/sap/top_shop/organic/other) and per Level 2 category. */
export function breakdownGmv(rows: RawMetricRow[]): {
  bySource: Record<string, number>;
  topSubCategories: { sub_category: string; gmv: number }[];
} {
  const bySource: Record<string, number> = {};
  const bySubCat = new Map<string, number>();
  for (const row of rows) {
    if (row.metric !== "affiliate_gmv" || row.value === null) continue;
    if (row.sub_category === null) {
      const src = row.source ?? "other";
      bySource[src] = (bySource[src] ?? 0) + Number(row.value);
    } else {
      bySubCat.set(row.sub_category, (bySubCat.get(row.sub_category) ?? 0) + Number(row.value));
    }
  }
  const topSubCategories = [...bySubCat.entries()]
    .map(([sub_category, gmv]) => ({ sub_category, gmv }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 5);
  return { bySource, topSubCategories };
}

/**
 * Top sub-categories from creator_top_products (Module 0.5 Fase 2 — replaces
 * the sub_category breakdown rows read from platform_metrics_raw). No `source`
 * dimension exists on the aggregate tables (tap/sap/... was a
 * platform_metrics_raw-only column), so gmv_by_source is intentionally empty
 * when this path is used — the report UI already renders "—" for an empty map.
 */
export function topSubCategoriesFromProducts(
  rows: TopProductRow[]
): { sub_category: string; gmv: number }[] {
  const bySubCat = new Map<string, number>();
  for (const row of rows) {
    if (!row.level2_category || row.gmv === null) continue;
    bySubCat.set(row.level2_category, (bySubCat.get(row.level2_category) ?? 0) + Number(row.gmv));
  }
  return [...bySubCat.entries()]
    .map(([sub_category, gmv]) => ({ sub_category, gmv }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 5);
}

/**
 * Skip-LLM gate (PRD §2.4): weekly reports skip the insight layer when every
 * trigger metric (GMV & views) moved ≤ threshold — data-only, 0 token AI.
 * Monthly reports always get an insight. A missing previous period (null delta)
 * counts as a significant change: the first report deserves a narrative.
 */
export function shouldSkipInsight(
  periodType: PeriodType,
  deltas: { gmv: number | null; views: number | null },
  threshold: number
): boolean {
  if (periodType === "monthly") return false;
  const triggers = [deltas.gmv, deltas.views];
  return triggers.every((d) => d !== null && Math.abs(d) <= threshold);
}

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function fmtIso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Real W1-W5 window [start, endExclusive) containing `iso` (upload week-scheme,
 * CLAUDE.md/lib/utils/date.ts validateW1W5Period) — fixes the bug where a blind
 * "start + 7 days" swallowed part of the next month for W5 starts (day 29-31).
 */
function weekWindowBounds(iso: string): { start: string; end: string } {
  const { y, m, d } = parseIso(iso);
  const last = daysInMonth(y, m);
  const startDay = d <= 7 ? 1 : d <= 14 ? 8 : d <= 21 ? 15 : d <= 28 ? 22 : 29;
  const endDay = d <= 7 ? 7 : d <= 14 ? 14 : d <= 21 ? 21 : d <= 28 ? 28 : last;
  return { start: fmtIso(y, m, startDay), end: addDaysIso(fmtIso(y, m, endDay), 1) };
}

/** Number of contiguous W1-W5 windows spanning [start, endExclusive). */
function windowCount(start: string, endExclusive: string): number {
  let count = 0;
  let cursor = start;
  while (cursor < endExclusive && count < 1000) {
    cursor = weekWindowBounds(cursor).end;
    count++;
  }
  return count;
}

/** Walks `n` W1-W5 windows backward from `start` (crosses month boundaries correctly). */
function stepWindowsBack(start: string, n: number): string {
  let cursor = start;
  for (let i = 0; i < n; i++) cursor = weekWindowBounds(addDaysIso(cursor, -1)).start;
  return cursor;
}

/**
 * Period boundaries. `start` is always a real window start (weekly/custom: a W1-W5
 * boundary; monthly: day 1) — validated by the caller (report-period-picker.tsx /
 * generateReport's zod schema), not re-derived here.
 *  - weekly: satu jendela W1-W5 mengandung `start` (endExclusive dihitung, bukan
 *    "start + 7 hari" yang menelan sebagian bulan berikutnya untuk W5).
 *  - monthly: `start` s/d awal bulan berikutnya (endExclusive opsional untuk
 *    kompatibilitas pemanggil lama, tapi selalu = +1 bulan pada praktiknya).
 *  - custom: `endExclusive` WAJIB (jendela terakhir yang dipilih user). Periode
 *    pembanding = jumlah jendela mingguan yang SAMA, tepat sebelum `start`.
 */
export function periodBounds(
  periodType: PeriodType,
  start: string,
  endExclusive?: string
): {
  start: string;
  end: string; // exclusive
  prevStart: string;
  prevEnd: string; // exclusive
} {
  if (periodType === "monthly") {
    const end = endExclusive ?? addMonthsIso(start, 1);
    return { start, end, prevStart: addMonthsIso(start, -1), prevEnd: start };
  }
  if (periodType === "weekly") {
    const w = weekWindowBounds(start);
    const end = endExclusive ?? w.end;
    return { start, end, prevStart: weekWindowBounds(addDaysIso(start, -1)).start, prevEnd: start };
  }
  // custom
  if (!endExclusive) throw new Error("Periode custom butuh tanggal akhir.");
  const n = windowCount(start, endExclusive);
  return { start, end: endExclusive, prevStart: stepWindowsBack(start, n), prevEnd: start };
}

const MAX_CUSTOM_MONTHS = 12;

/**
 * Validasi periode custom (C-04): `start` harus awal jendela W1-W5, `endExclusive`
 * harus akhir jendela W1-W5 (bukan tanggal sembarang di tengah), start < end, dan
 * rentang tidak lebih dari MAX_CUSTOM_MONTHS bulan (report_period_picker.tsx
 * membulatkan input user ke jendela terdekat SEBELUM memanggil ini — di sini
 * hanya menolak yang benar-benar tidak sejajar, mis. dari pemanggilan langsung).
 */
export function validateCustomPeriod(start: string, endExclusive: string): { valid: boolean; reason?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(endExclusive)) {
    return { valid: false, reason: "Format tanggal tidak valid." };
  }
  if (endExclusive <= start) return { valid: false, reason: "Tanggal akhir harus setelah tanggal mulai." };
  if (weekWindowBounds(start).start !== start) {
    return { valid: false, reason: "Tanggal mulai harus awal jendela mingguan (W1-W5)." };
  }
  if (weekWindowBounds(addDaysIso(endExclusive, -1)).end !== endExclusive) {
    return { valid: false, reason: "Tanggal akhir harus akhir jendela mingguan (W1-W5)." };
  }
  if (addMonthsIso(start, MAX_CUSTOM_MONTHS) < endExclusive) {
    return { valid: false, reason: `Rentang custom maksimal ${MAX_CUSTOM_MONTHS} bulan.` };
  }
  return { valid: true };
}

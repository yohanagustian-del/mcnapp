/**
 * M2 Report — deterministic data layer (PRD Module 02 §2.2–2.4).
 * Everything here is pure computation: aggregation, derived metrics, deltas,
 * and the skip-LLM gate. NO LLM in this module — the insight layer is separate.
 */

export type PeriodType = "weekly" | "monthly";

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

/** Period boundaries: weekly = [start, +7d), monthly = [start, +1 month). */
export function periodBounds(periodType: PeriodType, periodStart: string): {
  start: string;
  end: string; // exclusive
  prevStart: string;
  prevEnd: string; // exclusive
} {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const addPeriod = (d: Date, n: number) => {
    const copy = new Date(d);
    if (periodType === "weekly") copy.setUTCDate(copy.getUTCDate() + 7 * n);
    else copy.setUTCMonth(copy.getUTCMonth() + n);
    return copy;
  };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    start: iso(start),
    end: iso(addPeriod(start, 1)),
    prevStart: iso(addPeriod(start, -1)),
    prevEnd: iso(start),
  };
}

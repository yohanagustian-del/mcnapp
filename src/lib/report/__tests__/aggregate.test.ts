import { describe, expect, it } from "vitest";
import {
  breakdownGmv,
  computeDelta,
  deriveMetrics,
  periodBounds,
  shouldSkipInsight,
  sumMetrics,
  totalsFromPeriodSummary,
  topSubCategoriesFromProducts,
  type RawMetricRow,
} from "../aggregate";

const row = (metric: string, value: number, source: string | null = "tap", sub: string | null = null): RawMetricRow =>
  ({ metric, value, source, sub_category: sub });

describe("sumMetrics + deriveMetrics", () => {
  it("sums total rows and skips sub-category breakdown rows", () => {
    const rows = [
      row("affiliate_gmv", 10_000_000),
      row("affiliate_gmv", 5_000_000, "sap"),
      row("affiliate_gmv", 8_000_000, "tap", "Beauty"), // breakdown, not additive
      row("affiliate_orders", 100),
      row("video_views", 40_000),
      row("live_views", 10_000),
      row("affiliate_live_gmv", 6_000_000),
    ];
    const d = deriveMetrics(sumMetrics(rows));
    expect(d.gmv).toBe(15_000_000);
    expect(d.views).toBe(50_000);
    expect(d.aov).toBe(150_000);
    expect(d.gpm).toBe(300_000); // 15jt / 50k views × 1000
    expect(d.conversion).toBeCloseTo(0.002);
    expect(d.live_share).toBeCloseTo(0.4);
  });

  it("returns null ratios when denominators are zero", () => {
    const d = deriveMetrics(sumMetrics([]));
    expect(d.aov).toBeNull();
    expect(d.gpm).toBeNull();
    expect(d.conversion).toBeNull();
    expect(d.live_share).toBeNull();
  });
});

describe("computeDelta", () => {
  it("computes relative change", () => {
    expect(computeDelta(15_000_000, 10_000_000)).toBeCloseTo(0.5);
    expect(computeDelta(10_300_000, 10_000_000)).toBeCloseTo(0.03);
  });
  it("returns null without a previous basis", () => {
    expect(computeDelta(1_000_000, 0)).toBeNull();
  });
});

describe("shouldSkipInsight (PRD M2 §2.4)", () => {
  const threshold = 0.15;
  it("skips weekly when all triggers are within ±15% (PRD example: +3%)", () => {
    expect(shouldSkipInsight("weekly", { gmv: 0.03, views: -0.1 }, threshold)).toBe(true);
  });
  it("calls the LLM when one trigger exceeds the threshold (PRD example: +50%)", () => {
    expect(shouldSkipInsight("weekly", { gmv: 0.5, views: 0.02 }, threshold)).toBe(false);
  });
  it("never skips monthly reports", () => {
    expect(shouldSkipInsight("monthly", { gmv: 0.0, views: 0.0 }, threshold)).toBe(false);
  });
  it("treats a missing previous period as significant (first report gets insight)", () => {
    expect(shouldSkipInsight("weekly", { gmv: null, views: 0.01 }, threshold)).toBe(false);
  });
});

describe("breakdownGmv", () => {
  it("splits gmv by source and ranks sub-categories", () => {
    const rows = [
      row("affiliate_gmv", 10_000_000, "tap"),
      row("affiliate_gmv", 4_000_000, "sap"),
      row("affiliate_gmv", 7_000_000, "tap", "Beauty"),
      row("affiliate_gmv", 3_000_000, "tap", "Fashion"),
      row("video_views", 1000, "tap"), // ignored — not gmv
    ];
    const { bySource, topSubCategories } = breakdownGmv(rows);
    expect(bySource).toEqual({ tap: 10_000_000, sap: 4_000_000 });
    expect(topSubCategories[0]).toEqual({ sub_category: "Beauty", gmv: 7_000_000 });
    expect(topSubCategories).toHaveLength(2);
  });
});

describe("totalsFromPeriodSummary (Module 0.5 Fase 2 — creator_period_summary source)", () => {
  it("maps affiliate_gmv/live/video/orders into MetricTotals", () => {
    const t = totalsFromPeriodSummary({
      gmv_total: 15_000_000, affiliate_gmv: 15_000_000, affiliate_live_gmv: 6_000_000,
      affiliate_video_gmv: 9_000_000, orders: 100,
    });
    expect(t.gmv).toBe(15_000_000);
    expect(t.live_gmv).toBe(6_000_000);
    expect(t.video_gmv).toBe(9_000_000);
    expect(t.orders).toBe(100);
    expect(t.video_views).toBe(0); // no equivalent column — degrades like empty sumMetrics
  });

  it("falls back to gmv_total when affiliate_gmv is null", () => {
    const t = totalsFromPeriodSummary({
      gmv_total: 5_000_000, affiliate_gmv: null, affiliate_live_gmv: null, affiliate_video_gmv: null, orders: null,
    });
    expect(t.gmv).toBe(5_000_000);
  });

  it("null row (no period-summary data) → all zero, same shape as empty sumMetrics", () => {
    expect(totalsFromPeriodSummary(null)).toEqual(sumMetrics([]));
  });
});

describe("topSubCategoriesFromProducts (Module 0.5 Fase 2 — creator_top_products source)", () => {
  it("sums gmv per level2_category and ranks top 5", () => {
    const rows = [
      { level2_category: "Beauty", gmv: 7_000_000 },
      { level2_category: "Beauty", gmv: 1_000_000 },
      { level2_category: "Fashion", gmv: 3_000_000 },
    ];
    const result = topSubCategoriesFromProducts(rows);
    expect(result[0]).toEqual({ sub_category: "Beauty", gmv: 8_000_000 });
    expect(result[1]).toEqual({ sub_category: "Fashion", gmv: 3_000_000 });
  });

  it("ignores rows without a category or gmv", () => {
    const rows = [
      { level2_category: null, gmv: 5_000_000 },
      { level2_category: "Home", gmv: null },
    ];
    expect(topSubCategoriesFromProducts(rows)).toEqual([]);
  });

  it("caps at 5 categories", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ level2_category: `Cat${i}`, gmv: 8 - i }));
    expect(topSubCategoriesFromProducts(rows)).toHaveLength(5);
  });
});

describe("periodBounds", () => {
  it("weekly = 7-day window with the prior week as baseline", () => {
    expect(periodBounds("weekly", "2026-06-08")).toEqual({
      start: "2026-06-08", end: "2026-06-15",
      prevStart: "2026-06-01", prevEnd: "2026-06-08",
    });
  });
  it("monthly = calendar-month window", () => {
    expect(periodBounds("monthly", "2026-06-01")).toEqual({
      start: "2026-06-01", end: "2026-07-01",
      prevStart: "2026-05-01", prevEnd: "2026-06-01",
    });
  });
});

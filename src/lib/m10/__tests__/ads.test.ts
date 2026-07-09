import { describe, it, expect } from "vitest";
import {
  roasCrosscheck,
  briefNeedsApproval,
  initialBriefStatus,
  briefPriority,
  aggregateProjectAdsSpend,
  DEFAULT_ROAS_TOL,
} from "../ads";

describe("M10 ROAS cross-check (§2.3 — flag, not block)", () => {
  it("does not flag a matching roas (95/18 ≈ 5.28)", () => {
    const r = roasCrosscheck(95, 18, 5.28);
    expect(r.flagged).toBe(false);
    expect(r.computed).toBeCloseTo(5.277, 2);
  });
  it("flags a large mismatch (typo)", () => {
    expect(roasCrosscheck(95, 18, 2.0).flagged).toBe(true);
  });
  it("flags exactly beyond tolerance, not within", () => {
    // computed = 5, tol 0.05 → threshold 0.25; roas 5.2 (diff .2) not flagged, 5.3 (diff .3) flagged
    expect(roasCrosscheck(100, 20, 5.2).flagged).toBe(false);
    expect(roasCrosscheck(100, 20, 5.3).flagged).toBe(true);
  });
  it("honors a tunable tolerance", () => {
    expect(roasCrosscheck(100, 20, 5.5, 0.2).flagged).toBe(false); // wider tol accepts it
    expect(roasCrosscheck(100, 20, 5.5, 0.01).flagged).toBe(true);
  });
  it("is a no-op when ads_spent is 0 or roas missing (no divide-by-zero)", () => {
    expect(roasCrosscheck(100, 0, 5)).toEqual({ computed: null, flagged: false });
    expect(roasCrosscheck(100, 20, null)).toEqual({ computed: null, flagged: false });
  });
  it("exposes the default tolerance", () => {
    expect(DEFAULT_ROAS_TOL).toBe(0.05);
  });
});

describe("M10 budget cap enforcement at intake (§2.2 — over-cap → Director)", () => {
  it("under cap → no approval, status baru", () => {
    expect(briefNeedsApproval(40_000_000, 50_000_000)).toBe(false);
    expect(initialBriefStatus(40_000_000, 50_000_000)).toBe("baru");
  });
  it("over cap → approval, status menunggu_approval", () => {
    expect(briefNeedsApproval(60_000_000, 50_000_000)).toBe(true);
    expect(initialBriefStatus(60_000_000, 50_000_000)).toBe("menunggu_approval");
  });
  it("at exactly the cap is allowed", () => {
    expect(briefNeedsApproval(50_000_000, 50_000_000)).toBe(false);
  });
  it("unknown cap is conservative → gate", () => {
    expect(briefNeedsApproval(10_000_000, null)).toBe(true);
    expect(initialBriefStatus(10_000_000, null)).toBe("menunggu_approval");
  });
  it("no budget requested yet → no gate", () => {
    expect(briefNeedsApproval(null, 50_000_000)).toBe(false);
  });
});

describe("M10 brief priority (tunable)", () => {
  it("nearer deadline ranks higher (same budget)", () => {
    const soon = briefPriority(1, 10, 100);
    const later = briefPriority(30, 10, 100);
    expect(soon).toBeGreaterThan(later);
  });
  it("larger budget ranks higher (same deadline)", () => {
    expect(briefPriority(5, 90, 100)).toBeGreaterThan(briefPriority(5, 10, 100));
  });
  it("overdue (negative days) clamps to max urgency", () => {
    expect(briefPriority(-5, 10, 100)).toBe(briefPriority(0, 10, 100));
  });
});

describe("M10 single-source ads spend adapter (§2.3 — no double input into M7)", () => {
  const briefs = [
    { id: 1, project_id: 7 },
    { id: 2, project_id: 7 },
    { id: 3, project_id: null }, // deal-only brief → not a project spend
  ];
  const results = [
    { brief_id: 1, period: "2026-07-06", ads_spent: 18_000_000 },
    { brief_id: 2, period: "2026-07-06", ads_spent: 5_000_000 },
    { brief_id: 1, period: "2026-07-13", ads_spent: 9_000_000 },
    { brief_id: 3, period: "2026-07-06", ads_spent: 4_000_000 },
  ];
  it("sums ads_spent per (project, period) from results only", () => {
    const out = aggregateProjectAdsSpend(results, briefs);
    const day1 = out.find((o) => o.date === "2026-07-06" && o.project_id === 7);
    expect(day1?.ads_spend).toBe(23_000_000); // 18M + 5M, once each
    const day2 = out.find((o) => o.date === "2026-07-13" && o.project_id === 7);
    expect(day2?.ads_spend).toBe(9_000_000);
  });
  it("excludes briefs not tied to a project (no phantom project spend)", () => {
    const out = aggregateProjectAdsSpend(results, briefs);
    expect(out.every((o) => o.project_id === 7)).toBe(true);
    const total = out.reduce((s, o) => s + o.ads_spend, 0);
    expect(total).toBe(32_000_000); // 4M deal-only spend not included
  });
  it("counts each spend row exactly once (single source, no duplication)", () => {
    const out = aggregateProjectAdsSpend(results, briefs);
    const total = out.reduce((s, o) => s + o.ads_spend, 0);
    // total of project-linked results = 18+5+9 = 32M, not doubled
    expect(total).toBe(32_000_000);
  });
});

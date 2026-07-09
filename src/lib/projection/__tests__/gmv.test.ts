import { describe, expect, it } from "vitest";
import {
  aggregateFromSubcatSegmentRows,
  aggregateHistory,
  levelFactorOf,
  liveShareOf,
  priceSegmentOf,
  projectGmvRange,
  slotKey,
  subcatKey,
  type PriceBounds,
  type ProjectionConfig,
} from "../gmv";

// PRD M5 §2.1.1 defaults (in app_config as segments.price_bounds).
const BOUNDS: PriceBounds = { low: 180_000, entry: 800_000, sweet: 3_600_000, high: 8_000_000 };
const CFG: ProjectionConfig = {
  windowDays: 28,
  spread: 0.25,
  levelFactors: { "1": 0.85, "4": 1.05, "6": 1.25 },
  bounds: BOUNDS,
};

describe("priceSegmentOf", () => {
  it("maps the 5 PRD segments by upper bound", () => {
    expect(priceSegmentOf(50_000, BOUNDS)).toBe("low");
    expect(priceSegmentOf(180_000, BOUNDS)).toBe("entry");
    expect(priceSegmentOf(799_999, BOUNDS)).toBe("entry");
    expect(priceSegmentOf(800_000, BOUNDS)).toBe("sweet");
    expect(priceSegmentOf(3_600_000, BOUNDS)).toBe("high");
    expect(priceSegmentOf(8_000_000, BOUNDS)).toBe("premium");
  });
});

describe("aggregateHistory", () => {
  const rows = [
    // serum, unit price 200k (entry): 1jt GMV
    { creator_id: "CRT-A", level2_category: "Skincare Serum", affiliate_gmv: 1_000_000, affiliate_live_gmv: 600_000, items_sold: 5 },
    // serum again, unit price 100k (low): 400k GMV
    { creator_id: "CRT-A", level2_category: "skincare serum", affiliate_gmv: 400_000, affiliate_live_gmv: 0, items_sold: 4 },
    // no items_sold → counts in subcat & totals, not in any segment slot
    { creator_id: "CRT-A", level2_category: "Skincare Serum", affiliate_gmv: 250_000, affiliate_live_gmv: null, items_sold: null },
    // other creator
    { creator_id: "CRT-B", level2_category: "Skincare Serum", affiliate_gmv: 900_000, affiliate_live_gmv: 900_000, items_sold: 3 },
    // ignored: no creator / zero gmv
    { creator_id: null, level2_category: "X", affiliate_gmv: 99, affiliate_live_gmv: null, items_sold: 1 },
    { creator_id: "CRT-A", level2_category: "X", affiliate_gmv: 0, affiliate_live_gmv: null, items_sold: 1 },
  ];
  const agg = aggregateHistory(rows, BOUNDS);

  it("buckets GMV per (creator, subcat, derived price segment)", () => {
    expect(agg.bySlot.get(slotKey("CRT-A", "Skincare Serum", "entry"))).toBe(1_000_000);
    expect(agg.bySlot.get(slotKey("CRT-A", "Skincare Serum", "low"))).toBe(400_000);
    expect(agg.bySlot.get(slotKey("CRT-B", "skincare serum", "entry"))).toBe(900_000);
  });

  it("sums subcat GMV case-insensitively including rows without items_sold", () => {
    expect(agg.bySubcat.get(subcatKey("CRT-A", "SKINCARE SERUM"))).toBe(1_650_000);
  });

  it("tracks per-creator window totals & live share", () => {
    expect(agg.totals.get("CRT-A")).toEqual({ gmv: 1_650_000, liveGmv: 600_000 });
    expect(liveShareOf(agg.totals.get("CRT-B"))).toBe(1);
    expect(liveShareOf(agg.totals.get("CRT-Z"))).toBeNull();
  });
});

describe("aggregateFromSubcatSegmentRows (Module 0.5 Fase 2 — creator_subcat_segment_gmv source)", () => {
  const rows = [
    { creator_id: "CRT-A", level2_category: "Skincare Serum", price_segment: "entry" as const, gmv: 1_000_000, live_gmv: 600_000 },
    { creator_id: "CRT-A", level2_category: "Skincare Serum", price_segment: "low" as const, gmv: 400_000, live_gmv: 0 },
    // items_sold=0 at ingest → null segment: counts in subcat/totals, not in any slot
    { creator_id: "CRT-A", level2_category: "Skincare Serum", price_segment: null, gmv: 250_000, live_gmv: null },
    { creator_id: "CRT-B", level2_category: "Skincare Serum", price_segment: "entry" as const, gmv: 900_000, live_gmv: 900_000 },
    // ignored: no creator / zero or negative gmv
    { creator_id: null, level2_category: "X", price_segment: "low" as const, gmv: 99, live_gmv: null },
    { creator_id: "CRT-A", level2_category: "X", price_segment: "low" as const, gmv: 0, live_gmv: null },
  ];
  const agg = aggregateFromSubcatSegmentRows(rows);

  it("produces the same HistoryAggregate shape as aggregateHistory (bySlot)", () => {
    expect(agg.bySlot.get(slotKey("CRT-A", "Skincare Serum", "entry"))).toBe(1_000_000);
    expect(agg.bySlot.get(slotKey("CRT-A", "Skincare Serum", "low"))).toBe(400_000);
    expect(agg.bySlot.get(slotKey("CRT-B", "Skincare Serum", "entry"))).toBe(900_000);
  });

  it("sums subcat GMV including null-segment rows", () => {
    expect(agg.bySubcat.get(subcatKey("CRT-A", "Skincare Serum"))).toBe(1_650_000);
  });

  it("tracks per-creator totals & live share", () => {
    expect(agg.totals.get("CRT-A")).toEqual({ gmv: 1_650_000, liveGmv: 600_000 });
    expect(liveShareOf(agg.totals.get("CRT-B"))).toBe(1);
  });
});

describe("levelFactorOf", () => {
  it("reads the configured factor and defaults to 1", () => {
    expect(levelFactorOf(6, CFG.levelFactors)).toBe(1.25);
    expect(levelFactorOf(3, CFG.levelFactors)).toBe(1); // not configured
    expect(levelFactorOf(null, CFG.levelFactors)).toBe(1);
  });
});

describe("projectGmvRange", () => {
  it("returns basis × level factor ± spread as a range with method metadata", () => {
    const p = projectGmvRange(10_000_000, 4, CFG);
    expect(p.min).toBe(Math.round(10_000_000 * 1.05 * 0.75));
    expect(p.max).toBe(Math.round(10_000_000 * 1.05 * 1.25));
    expect(p.basisGmv).toBe(10_000_000);
    expect(p.durationFactor).toBe(1);
    expect(p.method).toContain("faktor_level(1.05)");
    expect(p.disclaimer.length).toBeGreaterThan(10);
  });

  it("scales by campaign duration relative to the window", () => {
    const p = projectGmvRange(28_000_000, null, CFG, 14);
    expect(p.durationFactor).toBe(0.5);
    expect(p.min).toBe(Math.round(28_000_000 * 0.5 * 0.75));
  });

  it("yields a zero range when there is no historical basis", () => {
    const p = projectGmvRange(0, 6, CFG);
    expect(p.min).toBe(0);
    expect(p.max).toBe(0);
  });
});

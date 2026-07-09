import { describe, expect, it } from "vitest";
import {
  checkProfitability,
  cumulativeTargets,
  filterLiveActive,
  trackDaily,
} from "../tracking";

describe("cumulativeTargets", () => {
  it("ramp-up: daily increments grow, cumulative ends exactly at target", () => {
    const t = cumulativeTargets(1_000_000, 4, "ramp"); // weights 1,2,3,4 (total 10)
    expect(t).toHaveLength(4);
    expect(t[0]).toBeCloseTo(100_000);
    expect(t[1]).toBeCloseTo(300_000);
    expect(t[3]).toBe(1_000_000);
    const inc1 = t[1] - t[0];
    const inc3 = t[3] - t[2];
    expect(inc3).toBeGreaterThan(inc1);
  });

  it("flat: equal daily targets", () => {
    const t = cumulativeTargets(900, 3, "flat");
    expect(t[0]).toBeCloseTo(300);
    expect(t[2]).toBe(900);
  });
});

describe("trackDaily", () => {
  const start = "2026-07-01";
  const end = "2026-07-10"; // 10 days, ramp weights 1..10 (total 55)

  it("computes cumulative progress, gap, run-rate and behind status", () => {
    // day 5 cumulative target = 1+2+3+4+5 / 55 = 15/55 of 5.5jt = 1.5jt
    const s = trackDaily(
      [
        { date: "2026-07-01", gmv: 200_000 },
        { date: "2026-07-03", gmv: 300_000 },
        { date: "2026-07-05", gmv: 400_000 },
      ],
      start, end, 5_500_000, 0.05
    );
    expect(s.totalDays).toBe(10);
    expect(s.daysElapsed).toBe(5);
    expect(s.cumActual).toBe(900_000);
    expect(s.cumTarget).toBeCloseTo(1_500_000);
    expect(s.gap).toBeCloseTo(-600_000);
    expect(s.runRateProjection).toBeCloseTo((900_000 / 5) * 10);
    expect(s.status).toBe("behind");
  });

  it("flags ahead beyond tolerance and on_track inside the band", () => {
    const ahead = trackDaily([{ date: "2026-07-01", gmv: 500_000 }], start, end, 5_500_000, 0.05);
    expect(ahead.status).toBe("ahead"); // day-1 target 100k, actual 500k

    const onTrack = trackDaily([{ date: "2026-07-01", gmv: 101_000 }], start, end, 5_500_000, 0.05);
    expect(onTrack.status).toBe("on_track");
  });

  it("ignores actuals outside the project period", () => {
    const s = trackDaily(
      [{ date: "2026-06-30", gmv: 999 }, { date: "2026-07-02", gmv: 100 }],
      start, end, 1_000_000, 0.05
    );
    expect(s.points).toHaveLength(1);
    expect(s.cumActual).toBe(100);
  });
});

describe("checkProfitability", () => {
  it("PRD example: ads < komisi MEA = aman; ads > komisi MEA = rugi (alert)", () => {
    const day5 = checkProfitability({ cumAdsSpend: 90_000_000, cumMeaRevenue: 110_000_000, adsBudgetCap: 300_000_000 });
    expect(day5.rugi).toBe(false);
    expect(day5.margin).toBe(20_000_000);

    const day12 = checkProfitability({ cumAdsSpend: 115_000_000, cumMeaRevenue: 108_000_000, adsBudgetCap: 300_000_000 });
    expect(day12.rugi).toBe(true);
    expect(day12.overCap).toBe(false);
  });

  it("flags over-cap independently of margin", () => {
    const c = checkProfitability({ cumAdsSpend: 310_000_000, cumMeaRevenue: 400_000_000, adsBudgetCap: 300_000_000 });
    expect(c.rugi).toBe(false);
    expect(c.overCap).toBe(true);
    expect(checkProfitability({ cumAdsSpend: 1, cumMeaRevenue: 2, adsBudgetCap: null }).overCap).toBe(false);
  });
});

describe("filterLiveActive", () => {
  it("keeps creators at/above the live GMV threshold (config, not hardcoded)", () => {
    const rows = [
      { creator_id: "CRT-A", metric: "affiliate_live_gmv", value: 40_000_000 },
      { creator_id: "CRT-A", metric: "affiliate_live_gmv", value: 30_000_000 },
      { creator_id: "CRT-B", metric: "affiliate_live_gmv", value: 10_000_000 },
      { creator_id: "CRT-B", metric: "affiliate_gmv", value: 999_000_000 }, // wrong metric ignored
    ];
    const active = filterLiveActive(rows, 65_000_000);
    expect(active.get("CRT-A")).toBe(70_000_000);
    expect(active.has("CRT-B")).toBe(false);
  });
});

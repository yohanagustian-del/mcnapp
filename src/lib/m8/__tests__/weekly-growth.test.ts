import { describe, expect, it } from "vitest";
import {
  availableMonths,
  buildMonthlyAverages,
  buildMonthlyGrowth,
  weekIndexOf,
  type AvgMonthlyGmvInputRow,
  type WeeklyGrowthInputRow,
} from "../weekly-growth";

describe("weekIndexOf (W1-W5 scheme)", () => {
  it("maps day-of-month to the correct week bucket", () => {
    expect(weekIndexOf("2026-06-01")).toBe(1);
    expect(weekIndexOf("2026-06-07")).toBe(1);
    expect(weekIndexOf("2026-06-08")).toBe(2);
    expect(weekIndexOf("2026-06-14")).toBe(2);
    expect(weekIndexOf("2026-06-15")).toBe(3);
    expect(weekIndexOf("2026-06-21")).toBe(3);
    expect(weekIndexOf("2026-06-22")).toBe(4);
    expect(weekIndexOf("2026-06-28")).toBe(4);
    expect(weekIndexOf("2026-06-29")).toBe(5);
    expect(weekIndexOf("2026-06-30")).toBe(5);
  });

  it("handles W5 for short and long months", () => {
    expect(weekIndexOf("2026-02-28")).toBe(4); // Feb non-leap, no W5
    expect(weekIndexOf("2024-02-29")).toBe(5); // leap year W5
    expect(weekIndexOf("2026-01-31")).toBe(5); // 31-day month W5
  });

  it("throws on an invalid date string", () => {
    expect(() => weekIndexOf("not-a-date")).toThrow();
  });
});

describe("availableMonths", () => {
  it("returns distinct YYYY-MM sorted desc", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-05-01", periodEnd: "2026-05-07", affiliateGmv: 10, createdAt: "2026-05-08T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 20, createdAt: "2026-06-08T00:00:00Z" },
      { creatorId: "CRT-2", periodStart: "2026-06-08", periodEnd: "2026-06-14", affiliateGmv: 30, createdAt: "2026-06-15T00:00:00Z" },
    ];
    expect(availableMonths(rows)).toEqual(["2026-06", "2026-05"]);
  });

  it("returns empty array for no rows", () => {
    expect(availableMonths([])).toEqual([]);
  });
});

describe("buildMonthlyGrowth", () => {
  it("builds W1-W4 GMV, month total, and deltas for a fully-filled month", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 100_000_000, createdAt: "2026-06-08T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-08", periodEnd: "2026-06-14", affiliateGmv: 120_000_000, createdAt: "2026-06-15T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-15", periodEnd: "2026-06-21", affiliateGmv: 90_000_000, createdAt: "2026-06-22T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-22", periodEnd: "2026-06-28", affiliateGmv: 150_000_000, createdAt: "2026-06-29T00:00:00Z" },
    ];
    const result = buildMonthlyGrowth(rows, "2026-06");
    const g = result.get("CRT-1");
    expect(g).toBeDefined();
    expect(g!.weeks).toEqual([100_000_000, 120_000_000, 90_000_000, 150_000_000, null]);
    expect(g!.monthTotal).toBe(460_000_000);
    expect(g!.deltas[0]).toBeNull();
    expect(g!.deltas[1]).toBeCloseTo(0.2, 5); // 120m vs 100m
    expect(g!.deltas[2]).toBeCloseTo((90 - 120) / 120, 5);
    expect(g!.deltas[3]).toBeCloseTo((150 - 90) / 90, 5);
    // month growth = last filled (W4) vs first filled (W1)
    expect(g!.monthGrowthPct).toBeCloseTo((150_000_000 - 100_000_000) / 100_000_000, 5);
  });

  it("handles a month with W5 (29-31)", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-01-01", periodEnd: "2026-01-07", affiliateGmv: 10, createdAt: "2026-01-08T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-01-29", periodEnd: "2026-01-31", affiliateGmv: 40, createdAt: "2026-02-01T00:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-01").get("CRT-1")!;
    expect(g.weeks).toEqual([10, null, null, null, 40]);
    expect(g.monthTotal).toBe(50);
    expect(g.deltas).toEqual([null, null, null, null, 3]); // (40-10)/10
    expect(g.monthGrowthPct).toBeCloseTo(3, 5);
  });

  it("skips gaps in the middle of the month (missing week stays null, delta compares to last filled)", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 100, createdAt: "2026-06-08T00:00:00Z" },
      // W2 missing
      { creatorId: "CRT-1", periodStart: "2026-06-15", periodEnd: "2026-06-21", affiliateGmv: 200, createdAt: "2026-06-22T00:00:00Z" },
      // W4 missing
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    expect(g.weeks).toEqual([100, null, 200, null, null]);
    expect(g.monthTotal).toBe(300);
    expect(g.deltas[0]).toBeNull();
    expect(g.deltas[1]).toBeNull(); // W2 not filled
    expect(g.deltas[2]).toBeCloseTo((200 - 100) / 100, 5); // W3 vs last filled (W1)
    expect(g.monthGrowthPct).toBeCloseTo((200 - 100) / 100, 5);
  });

  it("returns monthGrowthPct null when only one week is filled", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 100, createdAt: "2026-06-08T00:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    expect(g.weeks).toEqual([100, null, null, null, null]);
    expect(g.monthGrowthPct).toBeNull();
    expect(g.deltas.every((d) => d === null)).toBe(true);
  });

  it("dedupes duplicate (creator, periodStart) rows by latest createdAt", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 999, createdAt: "2026-06-08T00:00:00Z" },
      // Correction re-upload with a later createdAt should win.
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 111, createdAt: "2026-06-09T12:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    expect(g.weeks[0]).toBe(111);
    expect(g.monthTotal).toBe(111);
  });

  it("dedupe is order-independent (later createdAt wins regardless of array order)", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 111, createdAt: "2026-06-09T12:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 999, createdAt: "2026-06-08T00:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    expect(g.weeks[0]).toBe(111);
  });

  it("ignores rows outside the requested month", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-05-22", periodEnd: "2026-05-28", affiliateGmv: 500, createdAt: "2026-05-29T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 100, createdAt: "2026-06-08T00:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    expect(g.weeks).toEqual([100, null, null, null, null]);
    expect(g.monthTotal).toBe(100);
  });

  it("handles multiple creators independently", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 100, createdAt: "2026-06-08T00:00:00Z" },
      { creatorId: "CRT-2", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 300, createdAt: "2026-06-08T00:00:00Z" },
      { creatorId: "CRT-2", periodStart: "2026-06-08", periodEnd: "2026-06-14", affiliateGmv: 150, createdAt: "2026-06-15T00:00:00Z" },
    ];
    const result = buildMonthlyGrowth(rows, "2026-06");
    expect(result.size).toBe(2);
    expect(result.get("CRT-1")!.monthTotal).toBe(100);
    expect(result.get("CRT-2")!.monthTotal).toBe(450);
    expect(result.get("CRT-2")!.deltas[1]).toBeCloseTo((150 - 300) / 300, 5);
  });

  it("returns an empty map when no rows match the month", () => {
    const result = buildMonthlyGrowth([], "2026-06");
    expect(result.size).toBe(0);
  });

  it("prefers the canonical week-start row when two different period_start values collide on the same week index", () => {
    // Real-world case: a stray non-ingest upload_batch (e.g. a rolling product-metrics
    // window) can have period_start=2026-06-28, which also falls in the W4 bucket
    // (days 22-28) alongside the genuine weekly-ingest row period_start=2026-06-22.
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-22", periodEnd: "2026-06-28", affiliateGmv: 100, createdAt: "2026-06-29T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-28", periodEnd: "2026-07-04", affiliateGmv: 999, createdAt: "2026-07-05T00:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    // canonical W4 start (day 22) wins even though the day-28 row has a later createdAt.
    expect(g.weeks[3]).toBe(100);
    expect(g.monthTotal).toBe(100);
  });

  it("falls back to latest createdAt when neither/both colliding rows are canonical week-starts", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-23", periodEnd: "2026-06-29", affiliateGmv: 50, createdAt: "2026-06-24T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-25", periodEnd: "2026-07-01", affiliateGmv: 70, createdAt: "2026-06-26T00:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    expect(g.weeks[3]).toBe(70); // later createdAt wins
  });

  it("treats a zero-GMV previous week as a null delta (avoid divide-by-zero)", () => {
    const rows: WeeklyGrowthInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", periodEnd: "2026-06-07", affiliateGmv: 0, createdAt: "2026-06-08T00:00:00Z" },
      { creatorId: "CRT-1", periodStart: "2026-06-08", periodEnd: "2026-06-14", affiliateGmv: 50, createdAt: "2026-06-15T00:00:00Z" },
    ];
    const g = buildMonthlyGrowth(rows, "2026-06").get("CRT-1")!;
    expect(g.deltas[1]).toBeNull();
  });
});

describe("buildMonthlyAverages (task A.1 — /creators master list avg/bulan)", () => {
  it("averages across multiple months that each have data", () => {
    const rows: AvgMonthlyGmvInputRow[] = [
      // May: W1=100, W2=200 -> month total 300
      { creatorId: "CRT-1", periodStart: "2026-05-01", createdAt: "2026-05-08T00:00:00Z", gmvTotal: 100, affiliateLiveGmv: 60, affiliateVideoGmv: 40 },
      { creatorId: "CRT-1", periodStart: "2026-05-08", createdAt: "2026-05-15T00:00:00Z", gmvTotal: 200, affiliateLiveGmv: 120, affiliateVideoGmv: 80 },
      // June: W1=400 -> month total 400
      { creatorId: "CRT-1", periodStart: "2026-06-01", createdAt: "2026-06-08T00:00:00Z", gmvTotal: 400, affiliateLiveGmv: 300, affiliateVideoGmv: 100 },
    ];
    const avg = buildMonthlyAverages(rows);
    // (300 + 400) / 2 months = 350
    expect(avg.gmv).toBeCloseTo(350, 5);
    expect(avg.gmvLive).toBeCloseTo((180 + 300) / 2, 5);
    expect(avg.gmvVideo).toBeCloseTo((120 + 100) / 2, 5);
    expect(avg.monthsCounted).toBe(2);
  });

  it("returns the month total as-is when only one month has data", () => {
    const rows: AvgMonthlyGmvInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", createdAt: "2026-06-08T00:00:00Z", gmvTotal: 100, affiliateLiveGmv: 70, affiliateVideoGmv: 30 },
      { creatorId: "CRT-1", periodStart: "2026-06-22", createdAt: "2026-06-29T00:00:00Z", gmvTotal: 300, affiliateLiveGmv: 200, affiliateVideoGmv: 100 },
    ];
    const avg = buildMonthlyAverages(rows);
    expect(avg.gmv).toBeCloseTo(400, 5);
    expect(avg.gmvLive).toBeCloseTo(270, 5);
    expect(avg.gmvVideo).toBeCloseTo(130, 5);
    expect(avg.monthsCounted).toBe(1);
  });

  it("dedupes duplicate (creator, periodStart) rows by latest createdAt before averaging", () => {
    const rows: AvgMonthlyGmvInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", createdAt: "2026-06-08T00:00:00Z", gmvTotal: 999, affiliateLiveGmv: 999, affiliateVideoGmv: 999 },
      // Correction re-upload — later createdAt wins.
      { creatorId: "CRT-1", periodStart: "2026-06-01", createdAt: "2026-06-09T12:00:00Z", gmvTotal: 111, affiliateLiveGmv: 60, affiliateVideoGmv: 51 },
    ];
    const avg = buildMonthlyAverages(rows);
    expect(avg.gmv).toBeCloseTo(111, 5);
    expect(avg.gmvLive).toBeCloseTo(60, 5);
    expect(avg.gmvVideo).toBeCloseTo(51, 5);
    expect(avg.monthsCounted).toBe(1);
  });

  it("skips months with no rows entirely (does not count them as zero)", () => {
    // Only May and July have data — April/June (implicit gaps) are simply absent
    // from `rows`, so they never enter the average denominator.
    const rows: AvgMonthlyGmvInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-05-01", createdAt: "2026-05-08T00:00:00Z", gmvTotal: 100, affiliateLiveGmv: 100, affiliateVideoGmv: 0 },
      { creatorId: "CRT-1", periodStart: "2026-07-01", createdAt: "2026-07-08T00:00:00Z", gmvTotal: 300, affiliateLiveGmv: 300, affiliateVideoGmv: 0 },
    ];
    const avg = buildMonthlyAverages(rows);
    expect(avg.monthsCounted).toBe(2);
    expect(avg.gmv).toBeCloseTo(200, 5); // (100+300)/2, not /12 or /4
  });

  it("returns all-zero with monthsCounted=0 when there are no rows", () => {
    const avg = buildMonthlyAverages([]);
    expect(avg).toEqual({ gmv: 0, gmvLive: 0, gmvVideo: 0, monthsCounted: 0 });
  });

  it("live and video GMV average independently from total gmv", () => {
    const rows: AvgMonthlyGmvInputRow[] = [
      { creatorId: "CRT-1", periodStart: "2026-06-01", createdAt: "2026-06-08T00:00:00Z", gmvTotal: 100, affiliateLiveGmv: 80, affiliateVideoGmv: 20 },
      { creatorId: "CRT-1", periodStart: "2026-07-01", createdAt: "2026-07-08T00:00:00Z", gmvTotal: 200, affiliateLiveGmv: 50, affiliateVideoGmv: 150 },
    ];
    const avg = buildMonthlyAverages(rows);
    expect(avg.gmv).toBeCloseTo(150, 5);
    expect(avg.gmvLive).toBeCloseTo(65, 5);
    expect(avg.gmvVideo).toBeCloseTo(85, 5);
  });
});

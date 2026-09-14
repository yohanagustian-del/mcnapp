import { describe, expect, it } from "vitest";
import { aggregateUsageByWeek, formatWeekLabel } from "../usage";

const log = (member: string, iso: string) => ({ member_id: member, occurred_at: iso });

describe("aggregateUsageByWeek", () => {
  it("merges views within the session gap into one session", () => {
    const rows = aggregateUsageByWeek([
      log("u1", "2026-07-01T09:00:00Z"), // Rabu, minggu 2026-06-29
      log("u1", "2026-07-01T09:20:00Z"),
      log("u1", "2026-07-01T10:00:00Z"), // 40min gap > 30 → sesi baru
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessions).toBe(2);
    expect(rows[0].pageViews).toBe(3);
    // session1 = 20min, session2 = min 5min → 25min ≈ 0.4h
    expect(rows[0].hours).toBeCloseTo(0.4, 1);
  });

  it("splits by week (Senin−Minggu) and member", () => {
    const rows = aggregateUsageByWeek([
      log("u1", "2026-06-29T08:00:00Z"), // Senin minggu 2026-06-29
      log("u1", "2026-07-06T08:00:00Z"), // Senin minggu berikutnya
      log("u2", "2026-06-29T08:00:00Z"),
    ]);
    expect(rows).toHaveLength(3);
    const weeks = new Set(rows.map((r) => r.weekStart));
    expect(weeks).toEqual(new Set(["2026-06-29", "2026-07-06"]));
  });

  it("groups a session that starts Sunday into the week it started (not the week it ends)", () => {
    const rows = aggregateUsageByWeek([
      log("u1", "2026-07-05T23:50:00Z"), // Minggu, minggu 2026-06-29
      log("u1", "2026-07-06T00:05:00Z"), // Senin, gap 15 menit → sesi sama
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].weekStart).toBe("2026-06-29");
  });

  it("single view counts as minimum session duration", () => {
    const rows = aggregateUsageByWeek([log("u1", "2026-07-02T12:00:00Z")]);
    expect(rows[0].hours).toBe(0.1); // 5 menit, dibulatkan 1 desimal jam
    expect(rows[0].sessions).toBe(1);
  });

  it("empty input → empty output", () => {
    expect(aggregateUsageByWeek([])).toEqual([]);
  });

  it("month field derives from weekStart for month filtering", () => {
    const rows = aggregateUsageByWeek([log("u1", "2026-06-29T08:00:00Z")]);
    expect(rows[0].month).toBe("2026-06");
  });
});

describe("formatWeekLabel", () => {
  it("renders a Senin−Minggu range", () => {
    expect(formatWeekLabel("2026-06-29")).toBe("29–5 Jul 2026");
  });
});

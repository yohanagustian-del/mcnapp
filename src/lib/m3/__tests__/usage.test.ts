import { describe, expect, it } from "vitest";
import { aggregateUsageHours } from "../usage";

const log = (member: string, iso: string) => ({ member_id: member, occurred_at: iso });

describe("aggregateUsageHours", () => {
  it("merges views within the session gap into one session", () => {
    const rows = aggregateUsageHours([
      log("u1", "2026-07-01T09:00:00Z"),
      log("u1", "2026-07-01T09:20:00Z"),
      log("u1", "2026-07-01T10:00:00Z"), // 40min gap > 30 → still same? no: 40>30 → new session
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessions).toBe(2);
    expect(rows[0].pageViews).toBe(3);
    // session1 = 20min, session2 = min 5min → 25min ≈ 0.4h
    expect(rows[0].hours).toBeCloseTo(0.4, 1);
  });

  it("splits by month and member", () => {
    const rows = aggregateUsageHours([
      log("u1", "2026-06-30T23:00:00Z"),
      log("u1", "2026-07-01T08:00:00Z"),
      log("u2", "2026-07-01T08:00:00Z"),
    ]);
    expect(rows).toHaveLength(3);
    const months = new Set(rows.map((r) => r.month));
    expect(months).toEqual(new Set(["2026-06", "2026-07"]));
  });

  it("single view counts as minimum session duration", () => {
    const rows = aggregateUsageHours([log("u1", "2026-07-02T12:00:00Z")]);
    expect(rows[0].hours).toBe(0.1); // 5 menit, dibulatkan 1 desimal jam
    expect(rows[0].sessions).toBe(1);
  });

  it("empty input → empty output", () => {
    expect(aggregateUsageHours([])).toEqual([]);
  });
});

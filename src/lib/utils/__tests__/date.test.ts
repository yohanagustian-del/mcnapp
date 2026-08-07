import { describe, expect, it } from "vitest";
import { validateLeakPeriod, validateW1W5Period, weekOfMonth } from "../date";

describe("weekOfMonth (skema upload W1-W5)", () => {
  it("maps day-of-month to the correct week window", () => {
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 1)))).toBe(1);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 7)))).toBe(1);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 8)))).toBe(2);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 14)))).toBe(2);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 15)))).toBe(3);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 21)))).toBe(3);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 22)))).toBe(4);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 28)))).toBe(4);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 29)))).toBe(5);
    expect(weekOfMonth(new Date(Date.UTC(2026, 0, 31)))).toBe(5);
  });
});

describe("validateW1W5Period (skema upload W1-W5, CLAUDE.md)", () => {
  it("accepts all 5 windows for a 31-day month (January 2026)", () => {
    expect(validateW1W5Period("2026-01-01", "2026-01-07")).toEqual({ valid: true });
    expect(validateW1W5Period("2026-01-08", "2026-01-14")).toEqual({ valid: true });
    expect(validateW1W5Period("2026-01-15", "2026-01-21")).toEqual({ valid: true });
    expect(validateW1W5Period("2026-01-22", "2026-01-28")).toEqual({ valid: true });
    expect(validateW1W5Period("2026-01-29", "2026-01-31")).toEqual({ valid: true });
  });

  it("accepts W5 = 29-30 for a 30-day month (April 2026)", () => {
    expect(validateW1W5Period("2026-04-29", "2026-04-30")).toEqual({ valid: true });
  });

  it("Februari non-kabisat: tidak ada W5, W4 = 22-28 valid, 29 invalid", () => {
    // 2026 is not a leap year.
    expect(validateW1W5Period("2026-02-22", "2026-02-28")).toEqual({ valid: true });
    const result = validateW1W5Period("2026-02-29", "2026-02-29");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("Februari kabisat: W5 = 29-29", () => {
    // 2028 is a leap year.
    expect(validateW1W5Period("2028-02-29", "2028-02-29")).toEqual({ valid: true });
    expect(validateW1W5Period("2028-02-22", "2028-02-28")).toEqual({ valid: true });
  });

  it("rejects periods that cross a month boundary", () => {
    const result = validateW1W5Period("2026-01-29", "2026-02-04");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/bulan/i);
  });

  it("rejects when start or end is shifted by 1 day off a window boundary", () => {
    expect(validateW1W5Period("2026-01-02", "2026-01-07").valid).toBe(false);
    expect(validateW1W5Period("2026-01-01", "2026-01-08").valid).toBe(false);
    expect(validateW1W5Period("2026-01-30", "2026-01-31").valid).toBe(false);
  });

  it("rejects a range spanning multiple windows (e.g. 1-14)", () => {
    const result = validateW1W5Period("2026-01-01", "2026-01-14");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reason message is in Indonesian and mentions the sent period", () => {
    const result = validateW1W5Period("2026-01-01", "2026-01-14");
    expect(result.reason).toContain("2026-01-01");
    expect(result.reason).toContain("2026-01-14");
  });

  it("rejects malformed date strings without throwing", () => {
    const result = validateW1W5Period("29 Februari 2026", "2026-02-29");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe("validateLeakPeriod (gerbang longgar khusus /link-leakage)", () => {
  it("still accepts every W1-W5 window", () => {
    expect(validateLeakPeriod("2026-01-01", "2026-01-07")).toEqual({ valid: true, scheme: "w1w5" });
    expect(validateLeakPeriod("2026-01-08", "2026-01-14")).toEqual({ valid: true, scheme: "w1w5" });
    expect(validateLeakPeriod("2026-01-15", "2026-01-21")).toEqual({ valid: true, scheme: "w1w5" });
    expect(validateLeakPeriod("2026-01-22", "2026-01-28")).toEqual({ valid: true, scheme: "w1w5" });
    expect(validateLeakPeriod("2026-01-29", "2026-01-31")).toEqual({ valid: true, scheme: "w1w5" });
  });

  it("accepts a full month (day 1 to end of month) — the point of this gate", () => {
    expect(validateLeakPeriod("2026-01-01", "2026-01-31")).toEqual({
      valid: true,
      scheme: "sejak_tanggal_1",
    });
    // 30-day month, and February in a leap / non-leap year.
    expect(validateLeakPeriod("2026-04-01", "2026-04-30").valid).toBe(true);
    expect(validateLeakPeriod("2026-02-01", "2026-02-28").valid).toBe(true);
    expect(validateLeakPeriod("2028-02-01", "2028-02-29").valid).toBe(true);
  });

  it("accepts month-to-date (day 1 to any day in the same month)", () => {
    expect(validateLeakPeriod("2026-01-01", "2026-01-14").valid).toBe(true);
    expect(validateLeakPeriod("2026-01-01", "2026-01-20").valid).toBe(true);
    expect(validateLeakPeriod("2026-01-01", "2026-01-01").valid).toBe(true);
  });

  it("rejects a period that starts mid-month and is not a W1-W5 window", () => {
    // Kunci rollup = tanggal mulai, jadi 3-19 akan tersimpan sebagai "minggu 3" yang menyesatkan.
    const result = validateLeakPeriod("2026-01-03", "2026-01-19");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("2026-01-03");
  });

  it("rejects a period spanning two months", () => {
    const result = validateLeakPeriod("2026-01-01", "2026-02-15");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("menyebrang bulan");
  });

  it("rejects an end date past the end of the month", () => {
    expect(validateLeakPeriod("2026-02-01", "2026-02-30").valid).toBe(false);
  });

  it("rejects malformed date strings without throwing", () => {
    const result = validateLeakPeriod("1 Januari 2026", "2026-01-31");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

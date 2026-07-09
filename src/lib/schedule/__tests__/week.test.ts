import { describe, expect, it } from "vitest";
import {
  formatDayLabel,
  getWeekDays,
  getWeekStart,
  nextWeek,
  prevWeek,
} from "../week";

describe("getWeekStart (Monday, no TZ drift)", () => {
  it("returns Monday for a mid-week date", () => {
    // 2026-05-13 is a Wednesday → Monday 2026-05-11.
    expect(getWeekStart(new Date(2026, 4, 13))).toBe("2026-05-11");
  });

  it("returns the same date when given a Monday", () => {
    expect(getWeekStart(new Date(2026, 4, 11))).toBe("2026-05-11");
  });

  it("maps Sunday back to the preceding Monday", () => {
    // 2026-05-17 is a Sunday → Monday 2026-05-11.
    expect(getWeekStart(new Date(2026, 4, 17))).toBe("2026-05-11");
  });

  it("crosses a month boundary", () => {
    // 2026-06-02 is a Tuesday → Monday 2026-06-01.
    expect(getWeekStart(new Date(2026, 5, 2))).toBe("2026-06-01");
    // 2026-03-01 is a Sunday → Monday 2026-02-23.
    expect(getWeekStart(new Date(2026, 2, 1))).toBe("2026-02-23");
  });

  it("crosses a year boundary", () => {
    // 2027-01-01 is a Friday → Monday 2026-12-28.
    expect(getWeekStart(new Date(2027, 0, 1))).toBe("2026-12-28");
  });
});

describe("getWeekDays", () => {
  it("returns 7 consecutive ISO dates Mon..Sun", () => {
    expect(getWeekDays("2026-05-11")).toEqual([
      "2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14",
      "2026-05-15", "2026-05-16", "2026-05-17",
    ]);
  });

  it("spans a month boundary correctly", () => {
    expect(getWeekDays("2026-06-29")).toEqual([
      "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02",
      "2026-07-03", "2026-07-04", "2026-07-05",
    ]);
  });
});

describe("formatDayLabel", () => {
  it("formats Indonesian short label", () => {
    expect(formatDayLabel("2026-05-11")).toBe("Sen 11 Mei");
    expect(formatDayLabel("2026-01-04")).toBe("Min 4 Jan");
    expect(formatDayLabel("2026-12-25")).toBe("Jum 25 Des");
  });
});

describe("prevWeek / nextWeek", () => {
  it("steps by 7 days", () => {
    expect(prevWeek("2026-05-11")).toBe("2026-05-04");
    expect(nextWeek("2026-05-11")).toBe("2026-05-18");
  });

  it("steps across a year boundary", () => {
    expect(nextWeek("2026-12-28")).toBe("2027-01-04");
    expect(prevWeek("2027-01-04")).toBe("2026-12-28");
  });
});

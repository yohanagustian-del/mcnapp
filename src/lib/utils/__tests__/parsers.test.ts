import { describe, expect, it } from "vitest";
import { parseRupiah } from "../rupiah";
import { parseCommission } from "../commission";
import { parseFlexibleDate } from "../date";
import { genId } from "../id";

describe("parseRupiah (CLAUDE.md #7 — mixed legacy formats)", () => {
  it("parses comma-thousands format", () => {
    expect(parseRupiah("Rp1,075,484,867")).toBe(1_075_484_867);
  });
  it("parses dot-thousands format", () => {
    expect(parseRupiah("Rp4.131.512.642")).toBe(4_131_512_642);
  });
  it("parses dot-thousands with comma decimal", () => {
    expect(parseRupiah("Rp1.234.567,89")).toBe(1_234_567.89);
  });
  it("parses plain numbers and numeric input", () => {
    expect(parseRupiah("2263353095")).toBe(2_263_353_095);
    expect(parseRupiah(150000)).toBe(150000);
  });
  it("handles small grouped values", () => {
    expect(parseRupiah("Rp65.000.000")).toBe(65_000_000);
    expect(parseRupiah("Rp180,000")).toBe(180_000);
  });
  it("returns null for empty/dirty values instead of crashing", () => {
    expect(parseRupiah("")).toBeNull();
    expect(parseRupiah("-")).toBeNull();
    expect(parseRupiah(null)).toBeNull();
    expect(parseRupiah(undefined)).toBeNull();
    expect(parseRupiah("not found")).toBeNull();
  });
  it("handles negatives", () => {
    expect(parseRupiah("-Rp5.000")).toBe(-5000);
  });
});

describe("parseCommission (dirty legacy values)", () => {
  it("parses single percentages", () => {
    expect(parseCommission("10%")).toEqual({ min: 10, max: 10, isRange: false });
    expect(parseCommission("7,5%")).toEqual({ min: 7.5, max: 7.5, isRange: false });
  });
  it("parses ranges into separate min & max", () => {
    expect(parseCommission("5-7%")).toEqual({ min: 5, max: 7, isRange: true });
    expect(parseCommission("10 - 15 %")).toEqual({ min: 10, max: 15, isRange: true });
  });
  it("returns null (flag review) for garbage", () => {
    expect(parseCommission("not found")).toBeNull();
    expect(parseCommission("error")).toBeNull();
    expect(parseCommission("not yet")).toBeNull();
    expect(parseCommission("")).toBeNull();
    expect(parseCommission(null)).toBeNull();
  });
});

describe("parseFlexibleDate (free-text legacy dates)", () => {
  it("parses '19 February 2026'", () => {
    expect(parseFlexibleDate("19 February 2026")).toBe("2026-02-19");
  });
  it("parses '1 June 2026'", () => {
    expect(parseFlexibleDate("1 June 2026")).toBe("2026-06-01");
  });
  it("parses Indonesian month names", () => {
    expect(parseFlexibleDate("19 Februari 2026")).toBe("2026-02-19");
  });
  it("parses ISO and day-first numeric formats", () => {
    expect(parseFlexibleDate("2026-02-19")).toBe("2026-02-19");
    expect(parseFlexibleDate("19/02/2026")).toBe("2026-02-19");
  });
  it("returns null for empty/garbage", () => {
    expect(parseFlexibleDate("")).toBeNull();
    expect(parseFlexibleDate("soon")).toBeNull();
    expect(parseFlexibleDate("32 January 2026")).toBeNull();
  });
});

describe("genId (centralized entity IDs)", () => {
  it("generates prefixed 5-char ids", () => {
    expect(genId("CRT")).toMatch(/^CRT-[A-Z2-9]{5}$/);
    expect(genId("DEAL")).toMatch(/^DEAL-[A-Z2-9]{5}$/);
    expect(genId("LNK")).toMatch(/^LNK-[A-Z2-9]{5}$/);
  });
});

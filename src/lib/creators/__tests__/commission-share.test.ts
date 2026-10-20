import { describe, expect, it } from "vitest";
import { commissionShareToPct, parseCommissionSharePct } from "../commission-share";

describe("parseCommissionSharePct", () => {
  it("converts percent to fraction", () => {
    expect(parseCommissionSharePct("17")).toEqual({ ok: true, fraction: 0.17 });
    expect(parseCommissionSharePct("15")).toEqual({ ok: true, fraction: 0.15 });
  });

  it("accepts comma decimals and a trailing %", () => {
    expect(parseCommissionSharePct("17,5%")).toEqual({ ok: true, fraction: 0.175 });
  });

  it("treats empty as null", () => {
    expect(parseCommissionSharePct("  ")).toEqual({ ok: true, fraction: null });
  });

  it("rejects out-of-range and non-numeric input", () => {
    expect(parseCommissionSharePct("101").ok).toBe(false);
    expect(parseCommissionSharePct("-1").ok).toBe(false);
    expect(parseCommissionSharePct("abc").ok).toBe(false);
  });
});

describe("commissionShareToPct", () => {
  it("formats stored fractions (number or numeric string) as percent", () => {
    expect(commissionShareToPct(0.15)).toBe("15");
    expect(commissionShareToPct("0.175")).toBe("17.5");
  });

  it("tolerates legacy percent values and empties", () => {
    expect(commissionShareToPct(22)).toBe("22");
    expect(commissionShareToPct(null)).toBe("");
  });
});

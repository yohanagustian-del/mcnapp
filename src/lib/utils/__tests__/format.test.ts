import { describe, expect, it } from "vitest";
import { formatOkrTarget } from "../format";

/** Target OKR Setting: satu kolom angka yang dibaca sebagai angka/rupiah/persen. */
describe("formatOkrTarget", () => {
  it("renders rupiah with Indonesian thousand separators", () => {
    expect(formatOkrTarget(100_000_000, "rupiah")).toBe("Rp100.000.000");
    expect(formatOkrTarget(85_000_000, "rupiah")).toBe("Rp85.000.000");
  });

  it("renders plain counts without a unit prefix", () => {
    expect(formatOkrTarget(100, "angka")).toBe("100");
    expect(formatOkrTarget(50)).toBe("50");
  });

  it("renders percent with a % suffix", () => {
    expect(formatOkrTarget(15, "persen")).toBe("15%");
  });

  it("keeps decimals but never pads whole numbers", () => {
    expect(formatOkrTarget(2.5, "angka")).toBe("2,5");
    expect(formatOkrTarget(2, "angka")).toBe("2");
    expect(formatOkrTarget("1000.25", "rupiah")).toBe("Rp1.000,25");
  });

  it("returns an em dash for missing or unparseable targets", () => {
    expect(formatOkrTarget(null)).toBe("—");
    expect(formatOkrTarget(undefined)).toBe("—");
    expect(formatOkrTarget("")).toBe("—");
    expect(formatOkrTarget("bukan angka")).toBe("—");
  });
});

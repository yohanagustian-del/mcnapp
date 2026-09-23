import { describe, expect, it } from "vitest";
import {
  estimateLabel,
  gmvLevelEstimate,
  levelMismatch,
  type AffiliateLevelRule,
} from "../affiliate-level";

// Persis seed migrasi 0067 app_config `creators.affiliate_levels`.
const TABLE: AffiliateLevelRule[] = [
  { level: 0, minActiveDays: 1, minGmv: 0 },
  { level: 1, minActiveDays: 5, minGmv: 0 },
  { level: 2, minActiveDays: 15, minGmv: 6_500_000 },
  { level: 3, minActiveDays: 20, minGmv: 20_000_000 },
  { level: 4, minActiveDays: 25, minGmv: 65_000_000 },
  { level: 5, minActiveDays: 0, minGmv: 196_000_000 },
  { level: 6, minActiveDays: 0, minGmv: 654_000_000 },
  { level: 7, minActiveDays: 0, minGmv: 6_545_000_000 },
  { level: 8, minActiveDays: 0, minGmv: 20_000_000_000 },
];

describe("gmvLevelEstimate", () => {
  it("gmv 0 -> level tertinggi di antara L0/L1 (keduanya minGmv 0)", () => {
    expect(gmvLevelEstimate(0, TABLE)).toBe(1);
  });

  it("tepat di ambang minGmv suatu level -> level itu (>=, bukan >)", () => {
    expect(gmvLevelEstimate(6_500_000, TABLE)).toBe(2);
    expect(gmvLevelEstimate(6_499_999, TABLE)).toBe(1);
  });

  it("di antara dua ambang -> level lebih rendah", () => {
    expect(gmvLevelEstimate(10_000_000, TABLE)).toBe(2);
  });

  it("melebihi ambang tertinggi -> level maksimum (8), tidak lebih", () => {
    expect(gmvLevelEstimate(999_999_999_999, TABLE)).toBe(8);
  });

  it("tepat di ambang tertinggi -> 8", () => {
    expect(gmvLevelEstimate(20_000_000_000, TABLE)).toBe(8);
  });
});

describe("estimateLabel", () => {
  it('0 dan 1 dilabeli "≤L1" (tak terbedakan tanpa data hari aktif)', () => {
    expect(estimateLabel(0)).toBe("≤L1");
    expect(estimateLabel(1)).toBe("≤L1");
  });

  it("level >= 2 dilabeli L{n} apa adanya", () => {
    expect(estimateLabel(2)).toBe("L2");
    expect(estimateLabel(8)).toBe("L8");
  });
});

describe("levelMismatch", () => {
  it("mismatch true saat level tersimpan lebih rendah dari estimasi GMV", () => {
    const m = levelMismatch(1, 3);
    expect(m.mismatched).toBe(true);
    expect(m.imported).toBe(1);
    expect(m.estimate).toBe(3);
  });

  it("tidak mismatch saat level tersimpan sama atau lebih tinggi dari estimasi", () => {
    expect(levelMismatch(3, 3).mismatched).toBe(false);
    expect(levelMismatch(5, 3).mismatched).toBe(false);
  });

  it("tidak mismatch saat level tersimpan null (belum diimpor)", () => {
    expect(levelMismatch(null, 3).mismatched).toBe(false);
  });
});

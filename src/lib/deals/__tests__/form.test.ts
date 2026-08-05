import { describe, expect, it } from "vitest";
import { commissionRaw, dealReviewFlags } from "../form";

describe("commissionRaw", () => {
  it("nilai tunggal → \"10%\"", () => {
    expect(commissionRaw(10, undefined)).toBe("10%");
    expect(commissionRaw(10, null)).toBe("10%");
    // Max = min bukan range, jadi tidak ditulis "10-10%".
    expect(commissionRaw(10, 10)).toBe("10%");
  });

  it("range → \"5-7%\"", () => {
    expect(commissionRaw(5, 7)).toBe("5-7%");
    expect(commissionRaw(2.5, 3.5)).toBe("2.5-3.5%");
  });

  /** 0% komisi adalah nilai sah (campaign sample) dan HARUS beda dari "belum diisi". */
  it("0 tetap ditulis, bukan dianggap kosong", () => {
    expect(commissionRaw(0, undefined)).toBe("0%");
    expect(commissionRaw(0, 5)).toBe("0-5%");
  });

  it("min kosong → null (komisi belum diketahui)", () => {
    expect(commissionRaw(null, null)).toBeNull();
    expect(commissionRaw(undefined, undefined)).toBeNull();
  });
});

describe("dealReviewFlags", () => {
  it("lengkap → tanpa flag", () => {
    expect(dealReviewFlags({ shopId: "7495123456789", expDate: "2026-12-31" })).toEqual([]);
  });

  it("shop_id kosong → flag shop_id", () => {
    const flags = dealReviewFlags({ shopId: null, expDate: "2026-12-31" });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("shop_id");
  });

  it("exp_date kosong → flag exp_date (alert kadaluarsa M4 tidak bisa jalan)", () => {
    const flags = dealReviewFlags({ shopId: "7495123456789", expDate: null });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("exp_date");
  });

  it("dua-duanya kosong → dua flag", () => {
    expect(dealReviewFlags({ shopId: null, expDate: null })).toHaveLength(2);
  });
});

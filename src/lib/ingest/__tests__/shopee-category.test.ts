import { describe, expect, it } from "vitest";
import { normalizeShopeeCategory, SHOPEE_L2_CATEGORIES } from "../shopee-category";

describe("normalizeShopeeCategory", () => {
  it("returns the canonical spelling for an exact match", () => {
    expect(normalizeShopeeCategory("Dress")).toBe("Dress");
  });

  it("matches case-insensitively", () => {
    expect(normalizeShopeeCategory("dress")).toBe("Dress");
    expect(normalizeShopeeCategory("DRESS")).toBe("Dress");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeShopeeCategory("  Dress  ")).toBe("Dress");
  });

  it("returns null for text not in the official list, rather than guessing", () => {
    expect(normalizeShopeeCategory("Kategori Karangan")).toBeNull();
  });

  it("returns null for blank/null/undefined input", () => {
    expect(normalizeShopeeCategory("")).toBeNull();
    expect(normalizeShopeeCategory(null)).toBeNull();
    expect(normalizeShopeeCategory(undefined)).toBeNull();
  });

  it("has no duplicate categories in the official list", () => {
    expect(new Set(SHOPEE_L2_CATEGORIES).size).toBe(SHOPEE_L2_CATEGORIES.length);
  });

  it("contains exactly 262 official categories", () => {
    expect(SHOPEE_L2_CATEGORIES).toHaveLength(262);
  });
});

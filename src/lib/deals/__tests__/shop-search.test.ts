import { describe, it, expect } from "vitest";
import { sanitizeShopSearchTerm, shopNumeric, SHOP_PICKER_LIMIT } from "../shop-search";

/**
 * Pembersihan kata kunci pencarian shop. Yang dijaga di sini bukan sekadar kerapian:
 * kata kunci ditempel ke filter PostgREST `or=(...)`, jadi koma dan tanda kurung yang
 * lolos akan terbaca sebagai kondisi tambahan, bukan sebagai bagian nama shop.
 */
describe("sanitizeShopSearchTerm", () => {
  it("mengembalikan '' untuk kotak cari kosong — tandanya tampilkan daftar bawaan", () => {
    expect(sanitizeShopSearchTerm("")).toBe("");
    expect(sanitizeShopSearchTerm("   ")).toBe("");
  });

  it("meneruskan kata kunci biasa apa adanya", () => {
    expect(sanitizeShopSearchTerm("Dua Belibis")).toBe("Dua Belibis");
    expect(sanitizeShopSearchTerm("  Wardah  ")).toBe("Wardah");
    expect(sanitizeShopSearchTerm("7494504946518690203")).toBe("7494504946518690203");
  });

  it("membuang koma & tanda kurung yang punya arti khusus di filter PostgREST", () => {
    // Tanpa ini, "shop_id.gt.0" akan jadi kondisi tambahan pada or=(...).
    expect(sanitizeShopSearchTerm("a,shop_id.gt.0")).toBe("a shop_id.gt.0");
    expect(sanitizeShopSearchTerm("Toko (Official)")).toBe("Toko Official");
    expect(sanitizeShopSearchTerm("A, B")).toBe("A B");
  });

  it("merapatkan spasi sisa pembersihan jadi satu", () => {
    expect(sanitizeShopSearchTerm("Wardah   Beauty")).toBe("Wardah Beauty");
    expect(sanitizeShopSearchTerm("A,,,B")).toBe("A B");
  });

  it("mengembalikan null kalau kata kuncinya habis setelah dibersihkan", () => {
    // Dibedakan dari "" supaya ketikan "(((" tidak malah menampilkan daftar bawaan
    // seolah itu hasil pencariannya.
    expect(sanitizeShopSearchTerm("(((")).toBeNull();
    expect(sanitizeShopSearchTerm(",,,")).toBeNull();
    expect(sanitizeShopSearchTerm(" ( , ) ")).toBeNull();
  });
});

describe("shopNumeric", () => {
  it("membaca bigint/numeric yang datang sebagai string", () => {
    expect(shopNumeric("8")).toBe(8);
    expect(shopNumeric(8)).toBe(8);
  });

  it("jatuh ke 0 untuk nilai yang bukan angka", () => {
    expect(shopNumeric(null)).toBe(0);
    expect(shopNumeric(undefined)).toBe(0);
    expect(shopNumeric("bukan angka")).toBe(0);
  });
});

describe("SHOP_PICKER_LIMIT", () => {
  it("cukup kecil untuk satu daftar bergulir, cukup besar untuk daftar awal berguna", () => {
    expect(SHOP_PICKER_LIMIT).toBeGreaterThanOrEqual(20);
    expect(SHOP_PICKER_LIMIT).toBeLessThanOrEqual(200);
  });
});

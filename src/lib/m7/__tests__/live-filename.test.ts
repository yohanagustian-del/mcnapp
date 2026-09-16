import { describe, expect, it } from "vitest";
import { parseLiveFilename } from "../live-filename";

describe("parseLiveFilename", () => {
  it("parses the canonical product filename", () => {
    expect(parseLiveFilename("haikal_product_Sesi_1__5_September_2026.xlsx")).toEqual({
      username: "haikal",
      sessionNo: 1,
      date: "2026-09-05",
      kind: "product",
    });
  });

  it("parses the canonical trend_stats filename", () => {
    expect(parseLiveFilename("haikal_trend_stats_Sesi_1__5_September_2026.xlsx")).toEqual({
      username: "haikal",
      sessionNo: 1,
      date: "2026-09-05",
      kind: "trend_stats",
    });
  });

  it("tolerates capitalization variants (Product/product, Trend_Stat/trend_stats, Sesi/sesi)", () => {
    expect(parseLiveFilename("rara_Product_sesi_2__12_Oktober_2026.xlsx")?.kind).toBe("product");
    expect(parseLiveFilename("rara_Trend_Stat_sesi_2__12_Oktober_2026.xlsx")?.kind).toBe("trend_stats");
    expect(parseLiveFilename("rara_TREND_STATS_SESI_2__12_Oktober_2026.xlsx")?.kind).toBe("trend_stats");
  });

  it("parses double-digit day and session numbers", () => {
    expect(parseLiveFilename("glowbyrara_product_Sesi_12__28_Desember_2026.xlsx")).toEqual({
      username: "glowbyrara",
      sessionNo: 12,
      date: "2026-12-28",
      kind: "product",
    });
  });

  it("lowercases the username", () => {
    expect(parseLiveFilename("GlowByRara_product_Sesi_1__1_Januari_2026.xlsx")?.username).toBe(
      "glowbyrara"
    );
  });

  it("returns null for an unrecognized month name", () => {
    expect(parseLiveFilename("haikal_product_Sesi_1__5_Septembre_2026.xlsx")).toBeNull();
  });

  it("returns null for a day out of range", () => {
    expect(parseLiveFilename("haikal_product_Sesi_1__35_September_2026.xlsx")).toBeNull();
  });

  it("returns null for a filename missing the double underscore before the date", () => {
    expect(parseLiveFilename("haikal_product_Sesi_1_5_September_2026.xlsx")).toBeNull();
  });

  it("returns null for a completely unrelated filename", () => {
    expect(parseLiveFilename("laporan_mingguan.xlsx")).toBeNull();
    expect(parseLiveFilename("")).toBeNull();
  });

  it("returns null for a non-.xlsx extension", () => {
    expect(parseLiveFilename("haikal_product_Sesi_1__5_September_2026.csv")).toBeNull();
  });
});

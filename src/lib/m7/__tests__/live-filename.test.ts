import { describe, expect, it } from "vitest";
import { parseLiveFilename } from "../live-filename";

describe("parseLiveFilename", () => {
  it("parses the canonical product filename", () => {
    expect(parseLiveFilename("haikal_product_Sesi_1__5_September_2026.xlsx")).toEqual({
      username: "haikal",
      sessionNo: 1,
      date: "2026-09-05",
    });
  });

  it("parses the canonical trend_stats filename", () => {
    expect(parseLiveFilename("haikal_trend_stats_Sesi_1__5_September_2026.xlsx")).toEqual({
      username: "haikal",
      sessionNo: 1,
      date: "2026-09-05",
    });
  });

  it("tolerates capitalization variants (Product/product, Trend_Stat/trend_stats, Sesi/sesi)", () => {
    expect(parseLiveFilename("rara_Product_sesi_2__12_Oktober_2026.xlsx")?.sessionNo).toBe(2);
    expect(parseLiveFilename("rara_Trend_Stat_sesi_2__12_Oktober_2026.xlsx")?.sessionNo).toBe(2);
    expect(parseLiveFilename("rara_TREND_STATS_SESI_2__12_Oktober_2026.xlsx")?.sessionNo).toBe(2);
  });

  it("parses double-digit day and session numbers", () => {
    expect(parseLiveFilename("glowbyrara_product_Sesi_12__28_Desember_2026.xlsx")).toEqual({
      username: "glowbyrara",
      sessionNo: 12,
      date: "2026-12-28",
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

  // Real TikTok LIVE Center export filenames (2 creators, 16 Sep 2026 sample
  // batch) — comma-separated date, NOT the double-underscore the PRD assumed
  // before any real sample existed. Two different real uploaders even disagree
  // with each other on the username/kind separator (space vs underscore) and on
  // "Trend Stat" vs "trend stats" — both must parse.
  it("parses real export filenames with a space before the kind and a comma before the date", () => {
    expect(parseLiveFilename("haikalpratama136 Product sesi 1, 15 September 2026.xlsx")).toEqual({
      username: "haikalpratama136",
      sessionNo: 1,
      date: "2026-09-15",
    });
    expect(parseLiveFilename("haikalpratama136 Trend Stat Sesi 1, 15 September 2026.xlsx")).toEqual({
      username: "haikalpratama136",
      sessionNo: 1,
      date: "2026-09-15",
    });
  });

  it("parses real export filenames with an underscore before the kind and a comma before the date", () => {
    expect(parseLiveFilename("beayik_product Sesi 1, 15 September 2026.xlsx")).toEqual({
      username: "beayik",
      sessionNo: 1,
      date: "2026-09-15",
    });
    expect(parseLiveFilename("beayik_trend stats Sesi 1, 15 September 2026.xlsx")).toEqual({
      username: "beayik",
      sessionNo: 1,
      date: "2026-09-15",
    });
  });

  // An Account Manager renames these files by hand before upload (2026-09-17 QA
  // finding) — the product/trend-stats word is the first thing that gets dropped
  // or garbled. Username + "sesi" + number + date must still be enough on their
  // own; which sheet it actually is gets decided from its columns instead
  // (detectLiveFileKind, live-parse.ts), not from this word.
  it("parses filenames with the product/trend-stats word entirely missing", () => {
    expect(parseLiveFilename("tesakun_Sesi_1__17_September_2026.xlsx")).toEqual({
      username: "tesakun",
      sessionNo: 1,
      date: "2026-09-17",
    });
    expect(parseLiveFilename("tesakun Sesi 1, 17 September 2026.xlsx")).toEqual({
      username: "tesakun",
      sessionNo: 1,
      date: "2026-09-17",
    });
  });

  it("parses filenames with an unrecognized word in place of product/trend-stats", () => {
    expect(parseLiveFilename("tesakun_stats_Sesi_1__17_September_2026.xlsx")).toEqual({
      username: "tesakun",
      sessionNo: 1,
      date: "2026-09-17",
    });
  });

  it("still rejects a single underscore before the date even with no kind word (ambiguity guard unchanged)", () => {
    expect(parseLiveFilename("tesakun_Sesi_1_17_September_2026.xlsx")).toBeNull();
  });

  // Bug report (2026-09-24): a real username containing "_" (e.g. "bang_dull111")
  // got truncated to "bang" because the no-hint heuristic stops at the first
  // separator. When the caller supplies the selected participant's username (+
  // aliases) as a hint, it must be preferred over that heuristic.
  it("keeps a username containing '_' intact when it's supplied as a known candidate", () => {
    expect(
      parseLiveFilename("bang_dull111 Product sesi 1, 24 September 2026.xlsx", ["bang_dull111"])
    ).toEqual({ username: "bang_dull111", sessionNo: 1, date: "2026-09-24" });
    expect(
      parseLiveFilename("bang_dull111_Sesi_1__24_September_2026.xlsx", ["bang_dull111"])
    ).toEqual({ username: "bang_dull111", sessionNo: 1, date: "2026-09-24" });
  });

  it("still truncates at the first separator when the underscored username isn't a known candidate", () => {
    // Documents the residual ambiguity: without a hint, there's no way to tell a
    // real underscore-in-username apart from a dropped filler word.
    expect(
      parseLiveFilename("bang_dull111 Product sesi 1, 24 September 2026.xlsx")
    ).toEqual({ username: "bang", sessionNo: 1, date: "2026-09-24" });
  });

  it("prefers the longest matching known candidate (one alias isn't a prefix trap for another)", () => {
    expect(
      parseLiveFilename("bang_dull111 Product sesi 1, 24 September 2026.xlsx", ["bang", "bang_dull111"])
    ).toEqual({ username: "bang_dull111", sessionNo: 1, date: "2026-09-24" });
  });

  it("falls back to the no-hint heuristic when no known candidate matches the filename", () => {
    expect(
      parseLiveFilename("haikalpratama136 Product sesi 1, 15 September 2026.xlsx", ["someoneelse"])
    ).toEqual({ username: "haikalpratama136", sessionNo: 1, date: "2026-09-15" });
  });
});

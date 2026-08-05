import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseMasterShopFile, parseShopMasterRows } from "../master-shop-file";

/**
 * The master shop export is a working Google Sheet: the shop list can sit on a
 * later sheet, under title rows, and its 19-digit ids break when the column was
 * typed as a number. These tests pin that tolerance (same behaviour the CM team
 * knows from the old artifact).
 */

function workbook(sheets: Array<{ name: string; aoa: unknown[][] }>, filename = "master.xlsx"): File {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseMasterShopFile", () => {
  it("finds the shop list on a later sheet, below title rows", async () => {
    const file = workbook([
      { name: "Cover", aoa: [["Master Deal MEA"], ["update mingguan"]] },
      {
        name: "Shops",
        aoa: [
          ["MASTER ALL COOPERATING SHOPS"],
          [],
          ["Shop ID", "Shop Name", "Niche"],
          ["1739400000000000123", "Skintific", "Beauty"],
          ["1739400000000000456", "Somethinc", "Beauty"],
        ],
      },
    ]);
    const res = await parseMasterShopFile(file);
    expect(res.sheetName).toBe("Shops");
    expect(res.shopIds).toEqual(["1739400000000000123", "1739400000000000456"]);
    expect(res.shopNames.get("1739400000000000123")).toBe("Skintific");
    expect(res.warnings).toEqual([]);
  });

  it("accepts Indonesian header 'ID Toko' and dedupes repeated ids", async () => {
    const file = workbook([
      { name: "Sheet1", aoa: [["ID Toko"], ["111"], ["111"], ["222"], [""], ["-"]] },
    ]);
    const res = await parseMasterShopFile(file);
    expect(res.shopIds).toEqual(["111", "222"]);
    expect(res.warnings.join(" ")).toContain("tanpa Shop ID dilewati");
  });

  it("skips scientific-notation ids with a loud warning (precision lost)", async () => {
    const file = workbook([
      { name: "Sheet1", aoa: [["Shop ID"], ["1.7394E+18"], ["1739400000000000123"]] },
    ]);
    const res = await parseMasterShopFile(file);
    expect(res.shopIds).toEqual(["1739400000000000123"]);
    expect(res.warnings.join(" ")).toContain("notasi ilmiah");
  });

  it("throws a helpful error when no sheet has a Shop ID column", async () => {
    const file = workbook([{ name: "Rekap", aoa: [["Brand", "Komisi"], ["Skintific", "5%"]] }]);
    await expect(parseMasterShopFile(file)).rejects.toThrow(/tidak ada sheet dengan kolom "Shop ID"/);
  });

  it("warns when the column exists but carries no valid id", async () => {
    const file = workbook([{ name: "Sheet1", aoa: [["Shop ID"], [""], ["-"]] }]);
    const res = await parseMasterShopFile(file);
    expect(res.shopIds).toEqual([]);
    expect(res.warnings.join(" ")).toContain("tidak ada satu pun ID valid");
  });
});

/**
 * Full-row variant used by "Refresh Master Shop" (/link-leakage). It must tolerate
 * the same working-spreadsheet shapes as parseMasterShopFile — the previous
 * parseSheet() path read sheet 0 / row 0 only, so a real master export produced
 * "shop_id kosong" for every row.
 */
describe("parseShopMasterRows", () => {
  it("reads the full row from a later sheet, below title rows", async () => {
    const file = workbook([
      { name: "Cover", aoa: [["Master Deal MEA"]] },
      {
        name: "All Cooperating Shops",
        aoa: [
          ["MASTER ALL COOPERATING SHOPS"],
          [],
          ["Shop ID", "Shop Name", "Level 2 Categories (Unique)", "Total Collaborated Creators"],
          ["1739400000000000123", "Skintific", "Skincare", "1,204"],
          ["1739400000000000456", "Somethinc", "Makeup", "87"],
        ],
      },
    ]);
    const res = await parseShopMasterRows(file);
    expect(res.sheetName).toBe("All Cooperating Shops");
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      shop_id: "1739400000000000123",
      shop_name: "Skintific",
      "level_2_categories_(unique)": "Skincare",
      total_collaborated_creators: "1,204",
    });
  });

  it("drops scientific-notation ids instead of writing a corrupted 19-digit id", async () => {
    const file = workbook([
      { name: "Sheet1", aoa: [["Shop ID", "Shop Name"], ["1.7394E+18", "Rusak"], ["111", "Oke"]] },
    ]);
    const res = await parseShopMasterRows(file);
    expect(res.rows.map((r) => r.shop_id)).toEqual(["111"]);
    expect(res.warnings.join(" ")).toContain("notasi ilmiah");
  });

  it("skips fully blank rows but keeps rows with any value", async () => {
    const file = workbook([
      { name: "Sheet1", aoa: [["Shop ID", "Shop Name"], ["111", "A"], ["", ""], ["", "B"]] },
    ]);
    const res = await parseShopMasterRows(file);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[1]).toMatchObject({ shop_id: "", shop_name: "B" });
  });

  it("throws the same helpful error when no sheet has a Shop ID column", async () => {
    const file = workbook([{ name: "Rekap", aoa: [["Brand", "Komisi"], ["Skintific", "5%"]] }]);
    await expect(parseShopMasterRows(file)).rejects.toThrow(/tidak ada sheet dengan kolom "Shop ID"/);
  });
});

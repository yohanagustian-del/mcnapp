import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSheet } from "../sheet";

function xlsxFile(rows: Record<string, unknown>[], name = "data.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseSheet", () => {
  it("parses xlsx with normalized headers and string values", async () => {
    const file = xlsxFile([
      { "Creator Name": "Bella Beauty", "Affiliate GMV": 1500000, "Level 2 Category": "Skincare" },
      { "Creator Name": "Fira Fashion", "Affiliate GMV": 250000, "Level 2 Category": "Dress" },
    ]);
    const { rows, errors } = await parseSheet(file);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].creator_name).toBe("Bella Beauty");
    expect(rows[0].level_2_category).toBe("Skincare");
    expect(typeof rows[0].affiliate_gmv).toBe("string"); // stringified like CSV
  });

  it("falls back to CSV parser for .csv files", async () => {
    const file = new File(["Creator Name,GMV\nHana,100\n"], "data.csv", { type: "text/csv" });
    const { rows, errors } = await parseSheet(file);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ creator_name: "Hana", gmv: "100" }]);
  });

  /**
   * Regresi: template menandai kolom wajib dengan "*" ("Username*", "CM*").
   * Sebelum ini penanda itu ikut jadi bagian kunci ("username*"), sehingga
   * pembaca yang mencocokkan kunci persis — `pick(raw, ["username"])` — selalu
   * dapat string kosong dan kolomnya seolah tidak ada di file.
   */
  it("membuang penanda kolom wajib '*' dari header (xlsx maupun csv)", async () => {
    const xlsx = await parseSheet(xlsxFile([{ "Username*": "winris12", "CM*": "Netta" }]));
    expect(xlsx.errors).toEqual([]);
    expect(xlsx.rows[0]).toEqual({ username: "winris12", cm: "Netta" });

    const csv = await parseSheet(
      new File(["Username*,CM*\nwinris12,Netta\n"], "data.csv", { type: "text/csv" })
    );
    expect(csv.rows[0]).toEqual({ username: "winris12", cm: "Netta" });
  });

  it("header wajib tetap ditemukan walau template menulisnya 'Username*'", async () => {
    const { rows, errors } = await parseSheet(
      xlsxFile([{ "Username*": "winris12", "Nama Creator": "Win Ristanti" }]),
      ["username", "username*"]
    );
    expect(errors).toEqual([]);
    expect(rows[0].username).toBe("winris12");
  });

  it("reports empty xlsx workbook as error", async () => {
    const wb = XLSX.utils.book_new();
    // A workbook must have ≥1 sheet to write; simulate empty sheet instead.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Empty");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "empty.xlsx");
    const { rows } = await parseSheet(file);
    expect(rows).toEqual([]);
  });
});

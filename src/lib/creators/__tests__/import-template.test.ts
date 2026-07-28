import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildCreatorTemplate, TEMPLATE_FILENAME } from "../import-template";
import {
  buildImportRows,
  IMPORT_COLUMNS,
  SHEET_REQUIRED_HEADERS,
  type ImportContext,
} from "../import-spec";
import { parseSheet } from "@/lib/utils/sheet";

const ctx: ImportContext = {
  cmByName: new Map([["netta", { id: "uuid-netta", name: "Netta" }]]),
  existingByUsername: new Map(),
};

function templateWorkbook() {
  return XLSX.read(buildCreatorTemplate(["Netta", "Gabriel"]), { type: "array" });
}

describe("buildCreatorTemplate", () => {
  it("berisi sheet Kreator + Petunjuk", () => {
    expect(templateWorkbook().SheetNames).toEqual(["Kreator", "Petunjuk"]);
    expect(TEMPLATE_FILENAME).toBe("template_kreator.xlsx");
  });

  it("header sheet Kreator sama persis dengan IMPORT_COLUMNS, kolom wajib bertanda *", () => {
    const wb = templateWorkbook();
    const header = (
      XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Kreator, { header: 1 })[0] ?? []
    ) as string[];
    expect(header).toEqual(IMPORT_COLUMNS.map((c) => c.label));
    expect(header).toContain("Username*");
    expect(header).toContain("CM*");
  });

  it("sheet Petunjuk menandai kolom wajib dan mencantumkan daftar CM", () => {
    const guide = XLSX.utils.sheet_to_csv(templateWorkbook().Sheets.Petunjuk);
    expect(guide).toContain("Username*,WAJIB");
    expect(guide).toContain("CM*,WAJIB");
    expect(guide).toContain("Nama Creator,opsional");
    expect(guide).toContain("Netta");
  });

  /**
   * Regresi paling penting: template yang diunduh, diisi, lalu diunggah lagi
   * harus terbaca. Header memakai penanda "*" sehingga hanya lolos kalau
   * canonicalHeader benar-benar dipakai untuk pencocokan.
   */
  it("round-trip: template diisi → parseSheet → buildImportRows terbaca", async () => {
    const wb = templateWorkbook();
    const header = IMPORT_COLUMNS.map((c) => c.label);
    const row = header.map((label) => {
      if (label === "Username*") return "richannelvt";
      if (label === "CM*") return "Netta";
      if (label === "Kategory") return "Video Creator";
      return "";
    });
    XLSX.utils.sheet_add_aoa(wb.Sheets.Kreator, [row], { origin: "A2" });

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], TEMPLATE_FILENAME, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const { rows, errors } = await parseSheet(file, SHEET_REQUIRED_HEADERS);
    expect(errors).toEqual([]);

    const parsed = buildImportRows(rows, ctx);
    // Baris contoh kosong bawaan template dilewati, bukan dilaporkan sebagai error.
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe("insert");
    expect(parsed[0].username).toBe("richannelvt");
    expect(parsed[0].payload.owner_cpm_id).toBe("uuid-netta");
    expect(parsed[0].payload.jenis_creator).toBe("Video Creator");
  });
});

import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import * as XLSX from "xlsx";
import { normalizeHeader } from "../csv";
import { locateFirstSheet, streamLargeSheetRecords } from "../xlsx-stream";

/** What parseSheet's SheetJS path yields for header row `skip` (sheet.ts sheetToRows). */
function sheetJsRows(buf: Uint8Array, skip: number): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    raw: false,
    defval: "",
    range: skip,
  });
  return json.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[normalizeHeader(k)] = String(v ?? "").trim();
    return out;
  });
}

function streamRows(buf: Uint8Array, headerOk: ((keys: string[]) => boolean) | null) {
  const loc = locateFirstSheet(buf);
  expect(loc).not.toBeNull();
  const rows: Record<string, string>[] = [];
  const res = streamLargeSheetRecords(buf, loc!, 5, headerOk, normalizeHeader, (r) => rows.push(r));
  return { rows, skip: res?.skip ?? null };
}

function writeBook(ws: XLSX.WorkSheet, bookSST: boolean): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", bookSST }));
}

describe("streamLargeSheetRecords (large-xlsx path of parseSheet)", () => {
  const aoa: unknown[][] = [
    ["Laporan mingguan", null, null],
    ["Date", "Creator username", "Product ID", null, "GMV", "GMV", "Catatan"],
    ["2026-09-08 ~ 2026-09-14", "alya & co", 1729384756, "x", 1250000, 3.5, "Rp1.075.484"],
    [],
    ["Summary", "--", null, null, 99, 0.25, true],
    ["2026-09-08 ~ 2026-09-14", "  spasi  ", "17", null, 0, null, "日本語 <b>"],
  ];

  for (const bookSST of [false, true]) {
    it(`matches SheetJS output, header found after junk rows (bookSST=${bookSST})`, () => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["F3"].z = "0.00%";
      const buf = writeBook(ws, bookSST);
      const { rows, skip } = streamRows(buf, (keys) => keys.includes("creator_username"));
      expect(skip).toBe(1);
      expect(rows).toEqual(sheetJsRows(buf, 1));
      // Duplicate + empty header cells keyed exactly like SheetJS.
      expect(Object.keys(rows[0])).toEqual(["date", "creator_username", "product_id", "__empty", "gmv", "gmv_1", "catatan"]);
    });
  }

  it("headerOk = null reads row 1 as the header (parseSheet without required headers)", () => {
    const buf = writeBook(XLSX.utils.aoa_to_sheet(aoa), false);
    const { rows, skip } = streamRows(buf, null);
    expect(skip).toBe(0);
    expect(rows).toEqual(sheetJsRows(buf, 0));
  });

  it("returns null and emits nothing when no candidate header qualifies", () => {
    const buf = writeBook(XLSX.utils.aoa_to_sheet(aoa), false);
    const loc = locateFirstSheet(buf)!;
    const rows: unknown[] = [];
    expect(streamLargeSheetRecords(buf, loc, 5, (k) => k.includes("tidak_ada"), normalizeHeader, (r) => rows.push(r))).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it("reads TikTok-style exports: inline strings, no sharedStrings, absolute sheet target", () => {
    const cell = (ref: string, v: string | number) =>
      typeof v === "number"
        ? `<c r="${ref}"><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const sheet =
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<dimension ref="A1:C3"/><sheetData>` +
      `<row r="1">${cell("A1", "Creator username")}${cell("B1", "Shop ID")}${cell("C1", "GMV")}</row>` +
      `<row r="2">${cell("A2", "Summary")}${cell("C2", "Rp1.000")}</row>` +
      `<row r="3">${cell("A3", "toko &amp; teman")}${cell("B3", 7495012345)}${cell("C3", 12345.5)}</row>` +
      `</sheetData></worksheet>`;
    const buf = zipSync({
      "[Content_Types].xml": strToU8(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`
      ),
      "_rels/.rels": strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`
      ),
      "xl/workbook.xml": strToU8(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="Export" sheetId="1" r:id="rId4"/></sheets></workbook>`
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>` +
          `</Relationships>`
      ),
      "xl/worksheets/sheet2.xml": strToU8(sheet),
    });
    const loc = locateFirstSheet(buf)!;
    expect(loc.sheetPath).toBe("xl/worksheets/sheet2.xml");
    expect(loc.sharedStringsPath).toBeNull();
    const { rows } = streamRows(buf, (k) => k.includes("shop_id"));
    expect(rows).toEqual([
      { creator_username: "Summary", shop_id: "", gmv: "Rp1.000" },
      { creator_username: "toko & teman", shop_id: "7495012345", gmv: "12345.5" },
    ]);
    expect(rows).toEqual(sheetJsRows(buf, 0));
  });
});

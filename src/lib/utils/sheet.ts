import * as XLSX from "xlsx";
// Satu normalisasi header untuk XLSX dan CSV — kalau keduanya punya salinan
// sendiri, file yang sama bisa terbaca beda tergantung formatnya.
import { normalizeHeader, parseCsv, type CsvParseResult } from "./csv";

function sheetToRows(ws: XLSX.WorkSheet, skipRows: number): Record<string, string>[] {
  // raw:false → formatted strings (dates & numbers as displayed), matching CSV exports.
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: false,
    defval: "",
    range: skipRows,
  });
  return json.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[normalizeHeader(k)] = String(v ?? "").trim();
    return out;
  });
}

/**
 * Header-row test for sheets whose header text varies too much for an exact
 * key list (e.g. "Nama Brand (WAJIB SESUAI DISPLAY PLATFORM)"). Receives the
 * normalized keys of a candidate header row; `description` names the expected
 * header in the "not found" error.
 */
export type HeaderProbe = ((normalizedKeys: string[]) => boolean) & { description: string };

/**
 * Parse an uploaded platform file (.xlsx primary, .csv fallback) into rows with
 * normalized headers. XLSX is the primary format for platform data exports;
 * values are stringified so downstream parsers (parseRupiah/parseCount/date)
 * behave identically for both formats.
 *
 * `requiredHeaders`: legacy BD sheets often prepend junk rows before the real
 * header ("BULK-001,Femmy,,,…"). When given, up to 5 leading rows are skipped
 * until one of the required (normalized) headers appears. Apple Numbers exports
 * (.numbers) commonly carry an index row + a merged super-header row above the
 * real column header, so the skip window is generous. A `HeaderProbe` may be
 * passed instead of the key list when header spellings vary.
 */
export async function parseSheet(
  file: File,
  requiredHeaders?: string[] | HeaderProbe
): Promise<CsvParseResult> {
  const name = file.name.toLowerCase();
  const MAX_SKIP = 5;
  const hasRequired = (rows: Record<string, string>[]) => {
    if (!requiredHeaders) return true;
    if (typeof requiredHeaders === "function") return rows.length > 0 && requiredHeaders(Object.keys(rows[0]));
    return !requiredHeaders.length || (rows.length > 0 && requiredHeaders.some((h) => h in rows[0]));
  };
  const missingMessage = `Header wajib tidak ditemukan (${
    typeof requiredHeaders === "function" ? requiredHeaders.description : requiredHeaders?.join(", ")
  })`;

  // .numbers is a zip like xlsx; SheetJS reads it the same way.
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".numbers")) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { rows: [], errors: ["File Excel kosong (tidak ada sheet)"] };
    for (let skip = 0; skip <= MAX_SKIP; skip++) {
      const rows = sheetToRows(wb.Sheets[sheetName], skip);
      if (hasRequired(rows)) return { rows, errors: [], skippedRows: skip };
    }
    return { rows: [], errors: [missingMessage] };
  }

  const text = await file.text();
  for (let skip = 0; skip <= MAX_SKIP; skip++) {
    const attempt = parseCsv(text.split(/\r?\n/).slice(skip).join("\n"));
    if (hasRequired(attempt.rows)) return { ...attempt, errors: skip === 0 ? attempt.errors : [], skippedRows: skip };
  }
  return { rows: [], errors: [missingMessage] };
}

import * as XLSX from "xlsx";
// Satu normalisasi header untuk XLSX dan CSV — kalau keduanya punya salinan
// sendiri, file yang sama bisa terbaca beda tergantung formatnya.
import { normalizeHeader, parseCsv, type CsvParseResult } from "./csv";
import { locateFirstSheet, streamLargeSheetRecords, XLSX_STREAM_MIN_SHEET_BYTES } from "./xlsx-stream";

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
  const rows: Record<string, string>[] = [];
  const res = await forEachSheetRow(file, (r) => rows.push(r), requiredHeaders);
  return { ...res, rows };
}

/**
 * parseSheet, one row at a time: `onRow` receives each row (in file order) and
 * the rows are NOT collected. Weekly TikTok exports (500k rows) are read this way
 * by the ingest parsers so only their compact typed rows stay in memory.
 */
export async function forEachSheetRow(
  file: File,
  onRow: (row: Record<string, string>) => void,
  requiredHeaders?: string[] | HeaderProbe
): Promise<Omit<CsvParseResult, "rows">> {
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
  const emitAll = (rows: Record<string, string>[]) => {
    for (const r of rows) onRow(r);
  };

  // .numbers is a zip like xlsx; SheetJS reads it the same way.
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".numbers")) {
    const buf = new Uint8Array(await file.arrayBuffer());
    // Large worksheets (TikTok exports: 560–800MB of sheet XML) exceed V8's max
    // string length inside SheetJS, which then silently yields an EMPTY sheet —
    // read those with the streaming reader instead (same output, see xlsx-stream.ts).
    const loc = name.endsWith(".xlsx") ? locateFirstSheet(buf) : null;
    if (loc && (loc.sheetBytes ?? 0) >= XLSX_STREAM_MIN_SHEET_BYTES) {
      const keyCheck = requiredHeaders
        ? (keys: string[]) => hasRequired([Object.fromEntries(keys.map((k) => [k, ""]))])
        : null;
      const read = streamLargeSheetRecords(buf, loc, MAX_SKIP, keyCheck, normalizeHeader, onRow);
      if (!read) return { errors: [missingMessage] };
      return { errors: [], skippedRows: read.skip };
    }
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { errors: ["File Excel kosong (tidak ada sheet)"] };
    for (let skip = 0; skip <= MAX_SKIP; skip++) {
      const rows = sheetToRows(wb.Sheets[sheetName], skip);
      if (hasRequired(rows)) {
        emitAll(rows);
        return { errors: [], skippedRows: skip };
      }
    }
    return { errors: [missingMessage] };
  }

  const text = await file.text();
  for (let skip = 0; skip <= MAX_SKIP; skip++) {
    const attempt = parseCsv(text.split(/\r?\n/).slice(skip).join("\n"));
    if (hasRequired(attempt.rows)) {
      emitAll(attempt.rows);
      return { errors: skip === 0 ? attempt.errors : [], skippedRows: skip };
    }
  }
  return { errors: [missingMessage] };
}

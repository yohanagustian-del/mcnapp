import * as XLSX from "xlsx";
// Satu normalisasi header untuk seluruh platform (utils/csv) — kalau file master
// punya salinan sendiri, kolom yang sama bisa terbaca beda di halaman berbeda.
import { normalizeHeader as normalizeHeaderText } from "@/lib/utils/csv";

/**
 * Parser for the optional "Master Data Shop" file — the third upload of the old
 * external Agency Leaked Generator artifact (a Google-Sheets export whose only
 * guaranteed column is "Shop ID"). Deterministic, 0 LLM.
 *
 * Why a dedicated parser instead of parseSheet(): the master export is a working
 * spreadsheet, so the shop list is NOT always on the first sheet (parseSheet only
 * reads sheet 0) and the header row may sit below title/filter rows. This probes
 * EVERY sheet for a header containing "Shop ID" (same tolerance the artifact had),
 * within the first few rows of each sheet.
 *
 * Shop IDs are 19-digit numbers: a sheet saved with the column typed as a number
 * loses precision and shows up as scientific notation ("1.7397E+18"). Those rows
 * are SKIPPED with a loud warning instead of being silently matched against the
 * wrong shop (identical behaviour to the artifact, which the CM team is used to).
 */

/** Normalized ("shop id" → "shop_id") header matcher for the id column. */
const SHOP_ID_HEADERS = ["shop_id", "shopid", "id_toko", "id_shop"];
const SHOP_NAME_HEADERS = ["shop_name", "shopname", "nama_toko", "brand_name", "brand"];
/** How many leading rows of a sheet may precede the real header row. */
const MAX_HEADER_SCAN = 8;

export interface MasterShopFileResult {
  /** Partnered shop ids exactly as printed in the file (trimmed). */
  shopIds: string[];
  /** shopId → shop name when the file carries one (used only as a display fallback). */
  shopNames: Map<string, string>;
  /** Sheet the shop list was found in. */
  sheetName: string;
  /** Human-readable notes (scientific-notation rows skipped, empty ids, ...). */
  warnings: string[];
}

function normalizeHeader(h: unknown): string {
  return normalizeHeaderText(String(h ?? ""));
}

/** Finds the header row index + the id/name column indexes inside one sheet. */
function locateHeader(
  aoa: unknown[][]
): { headerRow: number; idCol: number; nameCol: number } | null {
  const limit = Math.min(aoa.length, MAX_HEADER_SCAN);
  for (let r = 0; r < limit; r++) {
    const headers = (aoa[r] ?? []).map(normalizeHeader);
    const idCol = headers.findIndex((h) => SHOP_ID_HEADERS.includes(h));
    if (idCol === -1) continue;
    const nameCol = headers.findIndex((h) => SHOP_NAME_HEADERS.includes(h));
    return { headerRow: r, idCol, nameCol };
  }
  return null;
}

/** The sheet + header row that actually carries the shop list. */
interface LocatedShopSheet {
  sheetName: string;
  aoa: unknown[][];
  headerRow: number;
  idCol: number;
  nameCol: number;
}

/**
 * Probes EVERY sheet (and the first few rows of each) for a shop-id header.
 * Returns the first hit, or the list of sheets tried so the caller can say which
 * file the user actually uploaded.
 */
function locateShopSheet(wb: XLSX.WorkBook): LocatedShopSheet | { sheetsTried: string[] } {
  const sheetsTried: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
    sheetsTried.push(sheetName);
    const loc = locateHeader(aoa);
    if (loc) return { sheetName, aoa, ...loc };
  }
  return { sheetsTried };
}

function missingShopIdError(sheetsTried: string[]): Error {
  return new Error(
    `Master Data Shop: tidak ada sheet dengan kolom "Shop ID" (sheet diperiksa: ${
      sheetsTried.join(", ") || "tidak ada"
    }). Pastikan file yang diunggah adalah export master shop (kolom Shop ID wajib ada).`
  );
}

/**
 * Parses the master shop file into the partnered shop-id list. Throws only when
 * no sheet carries a "Shop ID" column at all (the CM uploaded the wrong file) —
 * every other defect is a warning, never a crash (CLAUDE.md #7).
 */
export async function parseMasterShopFile(file: File): Promise<MasterShopFileResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const loc = locateShopSheet(wb);
  if ("sheetsTried" in loc) throw missingShopIdError(loc.sheetsTried);

  const { aoa, sheetName } = loc;
  const warnings: string[] = [];
  const shopIds: string[] = [];
  const shopNames = new Map<string, string>();
  const seen = new Set<string>();
  let scientific = 0;
  let empty = 0;

  for (let r = loc.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const raw = String(row[loc.idCol] ?? "").trim();
    if (raw === "" || raw === "-") {
      empty++;
      continue;
    }
    if (/e\+/i.test(raw)) {
      scientific++;
      continue;
    }
    const id = raw;
    if (!seen.has(id)) {
      seen.add(id);
      shopIds.push(id);
    }
    if (loc.nameCol !== -1) {
      const name = String(row[loc.nameCol] ?? "").trim();
      if (name && !shopNames.has(id)) shopNames.set(id, name);
    }
  }

  if (scientific > 0) warnings.push(scientificNotationWarning(scientific));
  if (empty > 0) warnings.push(`${empty} baris Master Data Shop tanpa Shop ID dilewati.`);
  if (shopIds.length === 0) {
    warnings.push(
      `Sheet "${sheetName}" punya kolom Shop ID tapi tidak ada satu pun ID valid — ` +
        `semua shop akan dihitung sebagai peluang BD (non-partnered).`
    );
  }

  return { shopIds, shopNames, sheetName, warnings };
}

function scientificNotationWarning(count: number): string {
  return (
    `${count} Shop ID di Master Data Shop rusak (notasi ilmiah, presisi hilang) dan DILEWATI — ` +
    `simpan ulang master dengan kolom Shop ID sebagai teks, lalu upload lagi.`
  );
}

export interface ShopMasterRowsResult {
  /** One record per data row, keyed by NORMALIZED header ("Shop Name" → "shop_name"). */
  rows: Record<string, string>[];
  /** Sheet the shop list was found in. */
  sheetName: string;
  /** Notes about rows dropped before they reached the caller. */
  warnings: string[];
}

/**
 * Full-row variant of parseMasterShopFile, for the weekly "Refresh Master Shop"
 * upload (/link-leakage) which needs Shop Name / Level 2 Categories / Total
 * Collaborated Creators too — not just the id list.
 *
 * Why not parseSheet(): parseSheet only ever reads sheet 0 and, without
 * `requiredHeaders`, treats row 0 as the header. The master export is a working
 * Google Sheet — the shop list often sits on a later sheet, under title/filter
 * rows — so parseSheet silently produced rows whose keys were the title text and
 * every single row was reported as "shop_id kosong". This reuses the same sheet /
 * header probing the analysis path already trusts.
 *
 * Rows whose Shop ID is in scientific notation ("1.7394E+18") are DROPPED here:
 * the 19-digit id has already lost precision, and writing it into the master
 * would silently mis-join every later leak analysis.
 */
export async function parseShopMasterRows(file: File): Promise<ShopMasterRowsResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const loc = locateShopSheet(wb);
  if ("sheetsTried" in loc) throw missingShopIdError(loc.sheetsTried);

  const { aoa, sheetName } = loc;
  const headers = (aoa[loc.headerRow] ?? []).map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  const warnings: string[] = [];
  let scientific = 0;

  for (let r = loc.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (/e\+/i.test(String(row[loc.idCol] ?? "").trim())) {
      scientific++;
      continue;
    }
    const record: Record<string, string> = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const value = String(row[c] ?? "").trim();
      record[key] = value;
      if (value !== "") hasValue = true;
    }
    if (hasValue) rows.push(record);
  }

  if (scientific > 0) warnings.push(scientificNotationWarning(scientific));
  return { rows, sheetName, warnings };
}

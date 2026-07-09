import * as XLSX from "xlsx";
import { parseRupiah } from "@/lib/utils/rupiah";

/**
 * Parser for the external "Agency Leaked Generator" artifact (two Excel files).
 * Deterministic, 0 LLM. Each CM runs the artifact weekly per creator; the platform
 * only STORES the resulting per-creator rollup (product detail stays in the Excel).
 *
 * TWO export formats are supported, auto-detected by PROBING SHEET CONTENT (never
 * by file/sheet name — the generator has already renamed sheets once and may again):
 *
 * Format v1 (legacy) — File 1:
 *   - "Executive Summary" sheet: one column-A row "Period: <start> to <end> | Generated: ..."
 *   - "Creator_Detail_Sections" sheet: per-creator blocks. Each block:
 *       "▶ CREATOR: <username>"
 *       bullet rows in column A ("• Total Affiliate GMV: Rp...", ...)
 *       a product table (IGNORED — rollup only).
 *   - "Leaked_Products_All" sheet: IGNORED.
 * Format v1 — File 2:
 *   - "BD_Shop_Summary" sheet: a fixed header row then data rows (shop-level BD leads).
 *   - "BD_Detail_Per_Shop" sheet: IGNORED.
 *
 * Format v2 (current) — File 1 "MEA_Agency_Link_Detail_*.xlsx":
 *   - "Ringkasan Creator" sheet: row 0 col A = a title containing
 *       "Detail Report <start> to <end>"; then label/value rows for the CM-level
 *       totals ("Total Creator Affiliate GMV", "Total TAP (Agency Link) GMV",
 *       "Potential Leak..."); then a "Per Creator Summary" marker row followed by
 *       [username, gmv] rows (NO per-creator leak/TAP/status breakdown — v2 simply
 *       does not have it, see CLAUDE.md decision — stored as null/unknown).
 *   - "Produk Bocor (Partnered Shops)" sheet: product detail, IGNORED (rollup only).
 * Format v2 — File 2 "MEA_BD_Opportunity_*.xlsx":
 *   - A shop-level BD sheet (name VARIES: "Ringkasan Shop Non-Partnered",
 *     "Ringkasan Peluang BD Shops", ...) detected by probing for a header row
 *     containing "Shop ID" + "Shop Name" + a GMV column. Columns: Shop ID, Shop
 *     Name, Level 1 Category, Total GMV (Rp), Creators (comma-separated usernames).
 *   - A per-product detail sheet: IGNORED.
 *
 * The parser is TOLERANT: a missing bullet/row yields null for that field + a
 * skipped note (never a crash). v1 bullets are matched by a STABLE PREFIX, not the
 * whole string.
 */

export type ArtifactFormat = "v1" | "v2";

/** Per-creator rollup parsed from the Leak Detail Report (raw bullet values). */
export interface LeakArtifactCreator {
  /** Username exactly as printed after "▶ CREATOR:". */
  creatorName: string;
  /** "Total Affiliate GMV" bullet (null if bullet missing/unparseable). */
  gmvAffiliateTotal: number | null;
  /** "Agency Link GMV (TAP)" bullet. */
  gmvTap: number | null;
  /** "Bocor (Leak)" bullet — leaked GMV on partnered shops. */
  gmvBocor: number | null;
  /** "Peluang BD (Non-Partnered Shops)" bullet. */
  bdOpportunityGmv: number | null;
  /** "Direct GMV" bullet. */
  directGmv: number | null;
  /** "Agency Link Effectiveness" bullet, as a fraction 0..1 (e.g. 7.5% → 0.075). */
  effectiveness: number | null;
}

/** CM-level totals only available in format v2 (Ringkasan Creator label/value rows). */
export interface LeakWeekTotals {
  gmvAffiliateTotal: number | null;
  gmvTap: number | null;
  gmvLeakPotential: number | null;
}

export interface LeakDetailParseResult {
  format: ArtifactFormat;
  periodStart: string;
  periodEnd: string;
  creators: LeakArtifactCreator[];
  /**
   * CM-level totals (format v2 only — Ringkasan Creator carries no per-creator
   * leak/TAP breakdown, only these three headline figures). Null for format v1
   * (the per-creator bullets already cover the same ground per creator).
   */
  weekTotals: LeakWeekTotals | null;
  /** Human-readable notes (missing bullets, blocks skipped). */
  skipped: string[];
}

/** One BD lead row parsed from BD_Shop_Summary (File 2). */
export interface BdShopRow {
  /** 19-digit numeric id kept as a STRING (never a float). */
  shopId: string;
  shopName: string | null;
  level1Category: string | null;
  level2Category: string | null;
  gmvOpportunity: number | null;
  /** "Num Creators" column → bd_leads.frequency. */
  numCreators: number | null;
  totalProductsPromoted: number | null;
}

export interface BdOpportunityParseResult {
  shops: BdShopRow[];
  skipped: string[];
}

/** Bullet prefix → the field it fills. Matched against the text after "• ". */
const BULLET_PREFIXES: Array<{ prefix: string; key: keyof LeakArtifactCreator }> = [
  { prefix: "Total Affiliate GMV", key: "gmvAffiliateTotal" },
  { prefix: "Agency Link GMV", key: "gmvTap" },
  { prefix: "Bocor (Leak)", key: "gmvBocor" },
  { prefix: "Peluang BD", key: "bdOpportunityGmv" },
  { prefix: "Direct GMV", key: "directGmv" },
  { prefix: "Agency Link Effectiveness", key: "effectiveness" },
];

const CREATOR_MARKER = "▶ CREATOR:";

/** Reads column A (index 0) of every row of a sheet as trimmed strings. */
function columnA(ws: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  return rows.map((r) => String((r as unknown[])[0] ?? "").trim());
}

/**
 * Extracts the numeric value token after a bullet's "Prefix:" segment. Some bullets
 * carry a trailing annotation ("Rp335.467.486  ← Commission lost..."); we keep only
 * the first amount token so parseRupiah/parsePercent don't choke on the suffix.
 */
function bulletValueAfterColon(line: string): string {
  const idx = line.indexOf(":");
  if (idx === -1) return "";
  const after = line.slice(idx + 1).trim();
  // First contiguous run of Rp/digits/.,%  → the value; stop at the annotation.
  const m = after.match(/^(?:Rp\.?\s*)?[\d.,]+%?/i);
  return m ? m[0].trim() : after;
}

/** "7.5%" / "7,5%" → 0.075; empty/unparseable → null. */
function parsePercent(raw: string): number | null {
  const s = raw.replace("%", "").replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n / 100 : null;
}

/**
 * Extracts period_start / period_end from the "Executive Summary" sheet's
 * "Period: YYYY-MM-DD to YYYY-MM-DD | Generated: ..." row. Returns null when the
 * marker row is absent or malformed (caller rejects the upload).
 */
export function extractArtifactPeriod(ws: XLSX.WorkSheet): { periodStart: string; periodEnd: string } | null {
  for (const cell of columnA(ws)) {
    const m = cell.match(/Period:\s*(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/i);
    if (m) return { periodStart: m[1], periodEnd: m[2] };
  }
  return null;
}

/** v2 title row: "... Detail Report YYYY-MM-DD to YYYY-MM-DD" (anywhere in column A). */
const V2_PERIOD_RE = /Detail Report\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i;

/** Extracts period_start / period_end from the v2 "Ringkasan Creator" title row. */
function extractV2Period(ws: XLSX.WorkSheet): { periodStart: string; periodEnd: string } | null {
  for (const cell of columnA(ws)) {
    const m = cell.match(V2_PERIOD_RE);
    if (m) return { periodStart: m[1], periodEnd: m[2] };
  }
  return null;
}

/**
 * Detects which artifact export format File 1 uses by PROBING SHEET CONTENT (never
 * sheet/file name, since the generator has already renamed sheets across versions):
 *   - v1: some sheet has a "▶ CREATOR:" block marker (unique to v1's
 *     Creator_Detail_Sections layout).
 *   - v2: some sheet has a "... Detail Report <date> to <date>" title row (unique
 *     to v2's Ringkasan Creator layout).
 * Each fingerprint uses ONLY its most distinctive marker — a missing/malformed
 * secondary row within a detected format (e.g. v1's "Period:" line, v2's "Per
 * Creator Summary" row) is a STRUCTURAL error raised by that format's own parser,
 * not a format-detection miss, so it is NOT part of the fingerprint here.
 * Returns null when neither marker is found (caller rejects with the sheet list).
 */
export function detectArtifactFormat(wb: XLSX.WorkBook): ArtifactFormat | null {
  let hasV1CreatorMarker = false;
  let hasV2Period = false;

  for (const name of wb.SheetNames) {
    const lines = columnA(wb.Sheets[name]);
    for (const line of lines) {
      if (!hasV1CreatorMarker && line.startsWith(CREATOR_MARKER)) hasV1CreatorMarker = true;
      if (!hasV2Period && V2_PERIOD_RE.test(line)) hasV2Period = true;
    }
  }

  if (hasV1CreatorMarker) return "v1";
  if (hasV2Period) return "v2";
  return null;
}

/**
 * Parses File 1 (Leak Detail Report), auto-detecting format v1 or v2 by content
 * probing (CLAUDE.md decision: never by sheet/file name). Throws only for
 * structural problems that make the file unusable (format not recognized, or
 * required marker rows missing within the detected format); per-creator bullet
 * gaps are recorded in `skipped`, not thrown.
 */
export async function parseLeakDetailFile(file: File): Promise<LeakDetailParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });

  const format = detectArtifactFormat(wb);
  if (format === "v2") return parseLeakDetailV2(wb);
  if (format === "v1") return parseLeakDetailV1(wb);

  throw new Error(
    `Format file tidak dikenali. Sheet yang ditemukan: [${wb.SheetNames.join(", ")}]. ` +
      "Diharapkan: format artifak lama (Executive Summary + Creator_Detail_Sections) atau baru " +
      "(Ringkasan Creator + Produk Bocor)."
  );
}

/** Parses File 1 in format v1 (legacy Executive Summary / Creator_Detail_Sections). */
function parseLeakDetailV1(wb: XLSX.WorkBook): LeakDetailParseResult {
  const execWs = wb.Sheets["Executive Summary"];
  if (!execWs) {
    throw new Error('Sheet "Executive Summary" tidak ditemukan di file Leak Detail Report.');
  }
  const period = extractArtifactPeriod(execWs);
  if (!period) {
    throw new Error(
      'Baris "Period: YYYY-MM-DD to YYYY-MM-DD" tidak ditemukan di sheet "Executive Summary". ' +
        "Pastikan file adalah hasil artifak Agency Leaked Generator yang valid."
    );
  }

  const detailWs = wb.Sheets["Creator_Detail_Sections"];
  if (!detailWs) {
    throw new Error('Sheet "Creator_Detail_Sections" tidak ditemukan di file Leak Detail Report.');
  }

  const lines = columnA(detailWs);
  const skipped: string[] = [];
  const creators: LeakArtifactCreator[] = [];

  // Split into per-creator blocks on the "▶ CREATOR:" marker; each block runs until
  // the next marker. Within a block, bullets ("• ...") are matched by stable prefix;
  // the product table rows below the bullets are ignored.
  let current: LeakArtifactCreator | null = null;
  const pushCurrent = () => {
    if (!current) return;
    for (const { prefix, key } of BULLET_PREFIXES) {
      if (current[key] === null && key !== "creatorName") {
        skipped.push(`Creator "${current.creatorName}": bullet "${prefix}" tidak ditemukan → null.`);
      }
    }
    creators.push(current);
  };

  for (const line of lines) {
    if (line.startsWith(CREATOR_MARKER)) {
      pushCurrent();
      const name = line.slice(CREATOR_MARKER.length).trim();
      current = {
        creatorName: name,
        gmvAffiliateTotal: null,
        gmvTap: null,
        gmvBocor: null,
        bdOpportunityGmv: null,
        directGmv: null,
        effectiveness: null,
      };
      continue;
    }
    if (!current) continue;
    if (!line.startsWith("•")) continue;

    const body = line.replace(/^•\s*/, "");
    const match = BULLET_PREFIXES.find((b) => body.startsWith(b.prefix));
    if (!match) continue;
    const value = bulletValueAfterColon(body);
    if (match.key === "effectiveness") {
      current.effectiveness = parsePercent(value);
    } else if (match.key !== "creatorName") {
      current[match.key] = parseRupiah(value);
    }
  }
  pushCurrent();

  if (creators.length === 0) {
    throw new Error(
      'Tidak ada blok "▶ CREATOR:" terbaca di sheet "Creator_Detail_Sections" — file kosong atau format berbeda.'
    );
  }

  return {
    format: "v1",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    creators,
    weekTotals: null,
    skipped,
  };
}

/**
 * Parses File 1 in format v2 ("Ringkasan Creator" + "Produk Bocor (Partnered
 * Shops)"). No per-creator leak/TAP breakdown exists in this format — only
 * gmv_affiliate_total is filled per creator; the CM-level totals are returned
 * separately in `weekTotals` (creator_link_status stores link_status/gmv_bocor/
 * leak_ratio as null = unknown, never a fabricated 0, per CLAUDE.md decision).
 */
function parseLeakDetailV2(wb: XLSX.WorkBook): LeakDetailParseResult {
  const ws = findSheetWithMarker(wb, (line) => V2_PERIOD_RE.test(line));
  if (!ws) {
    throw new Error(
      'Baris judul "... Detail Report YYYY-MM-DD to YYYY-MM-DD" tidak ditemukan pada file format baru. ' +
        "Pastikan file adalah hasil artifak Agency Leaked Generator (format Ringkasan Creator) yang valid."
    );
  }
  const period = extractV2Period(ws);
  if (!period) {
    throw new Error(
      'Baris judul "... Detail Report YYYY-MM-DD to YYYY-MM-DD" tidak dapat dibaca periodenya.'
    );
  }

  const skipped: string[] = [];

  // Label/value totals live on the SAME row (col A = label, col B = value), unlike
  // the "Per Creator Summary" list below which is [name, gmv] per row too — so we
  // read the sheet as an array-of-arrays (not just column A) for these rows.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  const rowAsStrings = rows.map((r) => (r as unknown[]).map((c) => String(c ?? "").trim()));

  const labelValue = (labelPrefix: string): number | null => {
    const row = rowAsStrings.find((r) => r[0].toLowerCase().startsWith(labelPrefix.toLowerCase()));
    if (!row) return null;
    return parseRupiah(row[1] ?? "");
  };

  const gmvAffiliateTotal = labelValue("Total Creator Affiliate GMV");
  const gmvTap = labelValue("Total TAP (Agency Link) GMV");
  const gmvLeakPotential = labelValue("Potential Leak");

  if (gmvAffiliateTotal === null) skipped.push('Baris "Total Creator Affiliate GMV" tidak ditemukan/tidak terbaca → null.');
  if (gmvTap === null) skipped.push('Baris "Total TAP (Agency Link) GMV" tidak ditemukan/tidak terbaca → null.');
  if (gmvLeakPotential === null) skipped.push('Baris "Potential Leak" tidak ditemukan/tidak terbaca → null.');

  const summaryIdx = rowAsStrings.findIndex((r) => r[0].toLowerCase() === "per creator summary");
  const creators: LeakArtifactCreator[] = [];
  if (summaryIdx === -1) {
    throw new Error(
      'Baris "Per Creator Summary" tidak ditemukan di sheet "Ringkasan Creator" — file kosong atau format berbeda.'
    );
  }
  for (let i = summaryIdx + 1; i < rowAsStrings.length; i++) {
    const row = rowAsStrings[i];
    const name = row[0];
    if (name === "") continue; // blank separator rows before the trailing Note.
    if (name.toLowerCase().startsWith("note:")) break; // trailing note row → end of list.
    const gmv = parseRupiah(row[1] ?? "");
    if (gmv === null) {
      skipped.push(`Creator "${name}": GMV pada "Per Creator Summary" tidak terbaca → dilewati.`);
      continue;
    }
    creators.push({
      creatorName: name,
      gmvAffiliateTotal: gmv,
      // Format v2 has no per-creator leak/TAP/effectiveness breakdown — unknown,
      // not zero (never fabricate a value the source report does not provide).
      gmvTap: null,
      gmvBocor: null,
      bdOpportunityGmv: null,
      directGmv: null,
      effectiveness: null,
    });
  }

  if (creators.length === 0) {
    throw new Error(
      'Tidak ada baris kreator terbaca di bawah "Per Creator Summary" — file kosong atau format berbeda.'
    );
  }

  return {
    format: "v2",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    creators,
    weekTotals: { gmvAffiliateTotal, gmvTap, gmvLeakPotential },
    skipped,
  };
}

/** Finds the first sheet whose column-A contains a line matching `test`. */
function findSheetWithMarker(wb: XLSX.WorkBook, test: (line: string) => boolean): XLSX.WorkSheet | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (columnA(ws).some(test)) return ws;
  }
  return null;
}

/** Exact header row the BD_Shop_Summary parser locks onto (order matters). */
export const BD_SHOP_SUMMARY_HEADER = [
  "Rank",
  "Shop ID",
  "Shop Name",
  "Level 1 Category",
  "Level 2 Category",
  "Total GMV Peluang",
  "Num Creators",
  "Total Products Promoted",
] as const;

function rowEquals(row: unknown[], header: readonly string[]): boolean {
  return header.every((h, i) => String(row[i] ?? "").trim() === h);
}

/**
 * Header row fingerprint for a v2 BD sheet: variable sheet name (seen so far:
 * "Ringkasan Shop Non-Partnered", "Ringkasan Peluang BD Shops"), so we probe by
 * CONTENT — a row containing at minimum "Shop ID" + "Shop Name" + a GMV column
 * (any label containing "GMV"), rather than an exact header match like v1's
 * BD_SHOP_SUMMARY_HEADER. A "Detail Produk..." sheet in the same workbook has the
 * same three columns plus "Product ID"/"Product Name" (per-product, per-creator
 * grain) — that sheet is IGNORED (per CLAUDE.md) by skipping any header row that
 * also has a "Product ID" column, so the shop-level summary sheet wins even when
 * it is not first in SheetNames order.
 */
function findV2BdHeader(
  wb: XLSX.WorkBook
): { ws: XLSX.WorkSheet; rows: unknown[][]; headerIdx: number; col: Record<string, number> } | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
    for (let i = 0; i < rows.length; i++) {
      const cells = (rows[i] as unknown[]).map((c) => String(c ?? "").trim());
      const shopIdIdx = cells.findIndex((c) => c.toLowerCase() === "shop id");
      const shopNameIdx = cells.findIndex((c) => c.toLowerCase() === "shop name");
      const gmvIdx = cells.findIndex((c) => c.toLowerCase().includes("gmv"));
      const hasProductId = cells.some((c) => c.toLowerCase() === "product id");
      if (shopIdIdx !== -1 && shopNameIdx !== -1 && gmvIdx !== -1 && !hasProductId) {
        const col: Record<string, number> = { shopId: shopIdIdx, shopName: shopNameIdx, gmv: gmvIdx };
        const l1Idx = cells.findIndex((c) => c.toLowerCase().startsWith("level 1"));
        const creatorsIdx = cells.findIndex((c) => c.toLowerCase() === "creators");
        if (l1Idx !== -1) col.level1 = l1Idx;
        if (creatorsIdx !== -1) col.creators = creatorsIdx;
        return { ws, rows: rows as unknown[][], headerIdx: i, col };
      }
    }
  }
  return null;
}

/**
 * Parses File 2 (BD Opportunity Report), auto-detecting format v1 (exact
 * BD_Shop_Summary header) or v2 (probed "Shop ID"/"Shop Name"/GMV header, any
 * sheet name — the generator has renamed this sheet before: "Ringkasan Shop
 * Non-Partnered", "Ringkasan Peluang BD Shops", ...). Optional file — a missing
 * sheet/header returns an empty result + a note, never throws. Shop ID is kept
 * as a string (19-digit ids must not become floats); GMV via parseRupiah.
 */
export async function parseBdOpportunityFile(file: File): Promise<BdOpportunityParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });

  const v1Ws = wb.Sheets["BD_Shop_Summary"];
  if (v1Ws) return parseBdV1(v1Ws);

  const v2 = findV2BdHeader(wb);
  if (v2) return parseBdV2(v2.rows, v2.headerIdx, v2.col);

  return {
    shops: [],
    skipped: [
      'Sheet BD tidak ditemukan (format lama "BD_Shop_Summary" atau format baru dengan header "Shop ID"/"Shop Name"/GMV) — file BD dilewati.',
    ],
  };
}

function parseBdV1(ws: XLSX.WorkSheet): BdOpportunityParseResult {
  const skipped: string[] = [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  const headerIdx = rows.findIndex((r) => rowEquals(r as unknown[], BD_SHOP_SUMMARY_HEADER));
  if (headerIdx === -1) {
    return {
      shops: [],
      skipped: [`Header BD_Shop_Summary tidak ditemukan (${BD_SHOP_SUMMARY_HEADER.join(", ")}) — file BD dilewati.`],
    };
  }

  const shops: BdShopRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const shopId = String(r[1] ?? "").trim();
    // Stop at the first blank shop id (data block is contiguous below the header).
    if (shopId === "") break;
    if (!/^\d+$/.test(shopId)) {
      skipped.push(`Baris BD dilewati: Shop ID "${shopId}" bukan numeric.`);
      continue;
    }
    shops.push({
      shopId,
      shopName: String(r[2] ?? "").trim() || null,
      level1Category: String(r[3] ?? "").trim() || null,
      level2Category: String(r[4] ?? "").trim() || null,
      gmvOpportunity: parseRupiah(String(r[5] ?? "")),
      numCreators: parseIntOrNull(String(r[6] ?? "")),
      totalProductsPromoted: parseIntOrNull(String(r[7] ?? "")),
    });
  }
  return { shops, skipped };
}

/**
 * Parses a v2 BD sheet (header located by content-probing — see findV2BdHeader).
 * Columns present: Shop ID, Shop Name, Level 1 Category, Total GMV (Rp), Creators
 * (comma-separated usernames — numCreators = count of non-empty items). No Level 2
 * Category or Total Products Promoted in this format → left null.
 */
function parseBdV2(rows: unknown[][], headerIdx: number, col: Record<string, number>): BdOpportunityParseResult {
  const skipped: string[] = [];
  const shops: BdShopRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c ?? "").trim());
    const shopId = r[col.shopId] ?? "";
    if (shopId === "") break; // contiguous data block below the header
    if (!/^\d+$/.test(shopId)) {
      skipped.push(`Baris BD dilewati: Shop ID "${shopId}" bukan numeric.`);
      continue;
    }
    const creatorsRaw = col.creators !== undefined ? r[col.creators] ?? "" : "";
    const numCreators =
      creatorsRaw.trim() === ""
        ? null
        : creatorsRaw.split(",").map((s) => s.trim()).filter(Boolean).length;
    shops.push({
      shopId,
      shopName: r[col.shopName]?.trim() || null,
      level1Category: col.level1 !== undefined ? r[col.level1]?.trim() || null : null,
      level2Category: null,
      gmvOpportunity: parseRupiah(r[col.gmv] ?? ""),
      numCreators,
      totalProductsPromoted: null,
    });
  }
  return { shops, skipped };
}

/** Plain integer parse ("1", "1.234" → 1234); null when unreadable. */
function parseIntOrNull(raw: string): number | null {
  const s = raw.replace(/[.,\s]/g, "");
  return s !== "" && /^\d+$/.test(s) ? Number(s) : null;
}

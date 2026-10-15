import { isSummaryRow } from "@/lib/utils/csv";
import { forEachSheetRow } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parsePeriodRange } from "@/lib/utils/date";
import { parseCount } from "@/lib/platform-csv";
import {
  MCN_COLUMNS, MCN_HEADER_ALIASES, TAP_COLUMNS, TAP_HEADER_ALIASES, parsePercent,
  type McnRow, type TapRow,
} from "./schema";

/**
 * Translates a row's Indonesian-language headers to the English internal field
 * names the rest of parse.ts reads (MCN_COLUMNS/TAP_COLUMNS), so a Bahasa Indonesia
 * platform export (account language setting) parses identically to the English one.
 *
 * Keys are assumed already normalized (trim→lowercase→spaces→"_") by parseCsv/
 * parseSheet. An English key already present on the row is NEVER overwritten by
 * its Indonesian alias — this keeps the English path's behavior unchanged even
 * if a row happens to carry both (defensive; not expected in practice).
 */
function translateRowKeys(row: Record<string, string>, aliases: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...row };
  for (const [idKey, enKey] of Object.entries(aliases)) {
    if (enKey in out) continue; // English header wins if somehow both present
    if (idKey in row) out[enKey] = row[idKey];
  }
  return out;
}

/**
 * Per-file string pool for the text fields kept on typed rows. The same creator,
 * shop, product and category text repeats across hundreds of thousands of rows;
 * pooling keeps one copy each. The pooled copy is a fresh flat string, so it does
 * not pin the large decoded XML chunk a cell value was sliced from (V8 sliced
 * strings keep their parent alive — on a 500k-row export that is GBs).
 */
function internOrNull(intern: (s: string) => string, s: string | undefined): string | null {
  return s ? intern(s) : null;
}

function createStringPool(): (s: string) => string {
  const pool = new Map<string, string>();
  return (s) => {
    let v = pool.get(s);
    if (v === undefined) {
      v = s.length > 12 ? (JSON.parse(JSON.stringify(s)) as string) : s;
      pool.set(v, v);
    }
    return v;
  };
}

export interface SkippedRow {
  row: number; // 1-based data row (header = line 1, so first data row = 2)
  reason: string;
}

export interface ParseResult<T> {
  rows: T[];
  skipped: SkippedRow[];
  /**
   * Normalized headers actually found in the file's first raw row (before any
   * ID→EN translation), regardless of whether any row survived the product/shop
   * filter. Empty when the file has no data rows at all. Used by run.ts to build
   * a more useful error message when parsing yields 0 rows despite a non-empty
   * file (task spec §3) — e.g. an unrecognized header set.
   */
  rawHeadersFound: string[];
}

/**
 * Parses the MCN (CSV-1 / all) report into internal rows. Skips the leading
 * "Summary" totals row and any row missing product/shop identity (can't be
 * joined or aggregated). Items sold == 0 is NOT skipped — GMV must still be
 * counted (CLAUDE.md #7 / Module 0.5 §2.2); the row's avg_price is simply
 * left undefined downstream (aggregate.ts guards div-by-zero).
 */
export async function parseMcnFile(file: File): Promise<ParseResult<McnRow>> {
  const skipped: SkippedRow[] = [];
  let rawHeadersFound: string[] = [];
  const rows: McnRow[] = [];
  let i = 0;
  const intern = createStringPool();

  // Row by row: a weekly export is up to 500k rows, the raw string records are
  // dropped as soon as each typed row is built.
  const { errors } = await forEachSheetRow(file, (raw0) => {
    const rowNum = i++ + 2;
    if (rowNum === 2) rawHeadersFound = Object.keys(raw0);
    if (isSummaryRow(raw0)) return;
    const r = translateRowKeys(raw0, MCN_HEADER_ALIASES);

    const productId = (r[MCN_COLUMNS.productId] ?? "").trim();
    const shopId = (r[MCN_COLUMNS.shopId] ?? "").trim();
    if (!productId || !shopId) {
      skipped.push({ row: rowNum, reason: "ID Produk / ID Toko kosong" });
      return;
    }
    const creatorName = (r[MCN_COLUMNS.creator] ?? "").trim();
    const range = parsePeriodRange(r[MCN_COLUMNS.date]);

    rows.push({
      date: intern(r[MCN_COLUMNS.date] ?? ""),
      periodStart: range?.start ?? null,
      periodEnd: range?.end ?? null,
      creatorName: intern(creatorName),
      followerCount: parseCount(r[MCN_COLUMNS.followerCount] ?? ""),
      productId: intern(productId),
      productInfo: internOrNull(intern, r[MCN_COLUMNS.productInfo]?.trim()),
      shopId: intern(shopId),
      shopName: internOrNull(intern, r[MCN_COLUMNS.shopName]?.trim()),
      level1Category: internOrNull(intern, r[MCN_COLUMNS.cat1]?.trim()),
      level2Category: internOrNull(intern, r[MCN_COLUMNS.cat2]?.trim()),
      affiliateGmv: parseRupiah(r[MCN_COLUMNS.gmv]) ?? 0,
      affiliateLiveGmv: parseRupiah(r[MCN_COLUMNS.gmvLive]) ?? 0,
      affiliateVideoGmv: parseRupiah(r[MCN_COLUMNS.gmvVideo]) ?? 0,
      orders: parseCount(r[MCN_COLUMNS.orders] ?? "") ?? 0,
      liveOrders: parseCount(r[MCN_COLUMNS.liveOrders] ?? "") ?? 0,
      videoOrders: parseCount(r[MCN_COLUMNS.videoOrders] ?? "") ?? 0,
      directGmv: parseRupiah(r[MCN_COLUMNS.directGmv]) ?? 0,
      itemsSold: parseCount(r[MCN_COLUMNS.itemsSold] ?? "") ?? 0,
      refundGmv: parseRupiah(r[MCN_COLUMNS.refundGmv]) ?? 0,
      ctr: parsePercent(r[MCN_COLUMNS.ctr]),
      ctor: parsePercent(r[MCN_COLUMNS.ctor]),
      liveDirectGmv: parseRupiah(r[MCN_COLUMNS.liveDirectGmv]) ?? 0,
      liveDirectOrders: parseCount(r[MCN_COLUMNS.liveDirectOrders] ?? "") ?? 0,
      liveItemsSold: parseCount(r[MCN_COLUMNS.liveItemsSold] ?? "") ?? 0,
    });
  });
  skipped.unshift(...errors.map((e) => ({ row: -1, reason: e })));
  return { rows, skipped, rawHeadersFound };
}

/**
 * Parses the TAP (CSV-2 / agency-link) report into internal rows. Same skip
 * rules as MCN (Summary row, missing product/shop identity).
 */
export async function parseTapFile(file: File): Promise<ParseResult<TapRow>> {
  const skipped: SkippedRow[] = [];
  let rawHeadersFound: string[] = [];
  const rows: TapRow[] = [];
  let i = 0;
  const intern = createStringPool();

  // Row by row: a weekly export is up to 500k rows, the raw string records are
  // dropped as soon as each typed row is built.
  const { errors } = await forEachSheetRow(file, (raw0) => {
    const rowNum = i++ + 2;
    if (rowNum === 2) rawHeadersFound = Object.keys(raw0);
    if (isSummaryRow(raw0)) return;
    const r = translateRowKeys(raw0, TAP_HEADER_ALIASES);

    const productId = (r[TAP_COLUMNS.productId] ?? "").trim();
    const shopId = (r[TAP_COLUMNS.shopId] ?? "").trim();
    if (!productId || !shopId) {
      skipped.push({ row: rowNum, reason: "ID Produk / ID Toko kosong" });
      return;
    }
    const creatorName = (r[TAP_COLUMNS.creator] ?? "").trim();
    const range = parsePeriodRange(r[TAP_COLUMNS.date]);

    rows.push({
      periodStart: range?.start ?? null,
      periodEnd: range?.end ?? null,
      creatorName: intern(creatorName),
      productId: intern(productId),
      productInfo: internOrNull(intern, r[TAP_COLUMNS.productInfo]?.trim()),
      shopId: intern(shopId),
      shopName: internOrNull(intern, r[TAP_COLUMNS.shopName]?.trim()),
      level2Category: internOrNull(intern, r[TAP_COLUMNS.cat2]?.trim()),
      affiliateGmv: parseRupiah(r[TAP_COLUMNS.gmv]) ?? 0,
      affiliateLiveGmv: parseRupiah(r[TAP_COLUMNS.gmvLive]) ?? 0,
      affiliateVideoGmv: parseRupiah(r[TAP_COLUMNS.gmvVideo]) ?? 0,
      orders: parseCount(r[TAP_COLUMNS.orders] ?? "") ?? 0,
      itemsSold: parseCount(r[TAP_COLUMNS.itemsSold] ?? "") ?? 0,
      estPartnerCommission: parseRupiah(r[TAP_COLUMNS.estPartnerCommission]),
      actualPartnerCommission: parseRupiah(r[TAP_COLUMNS.actualPartnerCommission]),
      estCreatorCommission: parseRupiah(r[TAP_COLUMNS.estCreatorCommission]),
      actualCreatorCommission: parseRupiah(r[TAP_COLUMNS.actualCreatorCommission]),
      refundGmv: parseRupiah(r[TAP_COLUMNS.refundGmv]) ?? 0,
    });
  });
  skipped.unshift(...errors.map((e) => ({ row: -1, reason: e })));
  return { rows, skipped, rawHeadersFound };
}

/** Derives the ingest period (min start, max end) across all parsed MCN rows. */
export function derivePeriod(rows: McnRow[]): { periodStart: string; periodEnd: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const r of rows) {
    if (r.periodStart && (!start || r.periodStart < start)) start = r.periodStart;
    if (r.periodEnd && (!end || r.periodEnd > end)) end = r.periodEnd;
  }
  return start && end ? { periodStart: start, periodEnd: end } : null;
}

/**
 * Appends a second MCN export of the SAME week (e.g. MEA Academy) to `main`, in
 * place, so one ingest batch covers both creator sets. Throws when the two files
 * cover different periods. Skip reasons of the extra file are prefixed so the
 * row numbers stay unambiguous.
 */
export function mergeExtraMcn(main: ParseResult<McnRow>, extra: ParseResult<McnRow>): void {
  const mainPeriod = derivePeriod(main.rows);
  const extraPeriod = derivePeriod(extra.rows);
  if (
    mainPeriod && extraPeriod &&
    (mainPeriod.periodStart !== extraPeriod.periodStart || mainPeriod.periodEnd !== extraPeriod.periodEnd)
  ) {
    throw new Error(
      `Periode file MCN tambahan (${extraPeriod.periodStart} s/d ${extraPeriod.periodEnd}) berbeda dengan ` +
        `file MCN utama (${mainPeriod.periodStart} s/d ${mainPeriod.periodEnd}) — keduanya harus minggu yang sama.`
    );
  }
  for (const r of extra.rows) main.rows.push(r);
  for (const s of extra.skipped) main.skipped.push({ ...s, reason: `File MCN tambahan: ${s.reason}` });
}

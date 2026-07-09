import { isSummaryRow } from "@/lib/utils/csv";
import { parseSheet } from "@/lib/utils/sheet";
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
  const { rows: raw, errors } = await parseSheet(file);
  const skipped: SkippedRow[] = errors.map((e) => ({ row: -1, reason: e }));
  const rawHeadersFound = raw.length > 0 ? Object.keys(raw[0]) : [];
  const rows: McnRow[] = [];

  for (const [i, raw0] of raw.entries()) {
    const rowNum = i + 2;
    if (isSummaryRow(raw0)) continue;
    const r = translateRowKeys(raw0, MCN_HEADER_ALIASES);

    const productId = (r[MCN_COLUMNS.productId] ?? "").trim();
    const shopId = (r[MCN_COLUMNS.shopId] ?? "").trim();
    if (!productId || !shopId) {
      skipped.push({ row: rowNum, reason: "ID Produk / ID Toko kosong" });
      continue;
    }
    const creatorName = (r[MCN_COLUMNS.creator] ?? "").trim();
    const range = parsePeriodRange(r[MCN_COLUMNS.date]);

    rows.push({
      date: r[MCN_COLUMNS.date] ?? "",
      periodStart: range?.start ?? null,
      periodEnd: range?.end ?? null,
      creatorName,
      productId,
      productInfo: r[MCN_COLUMNS.productInfo]?.trim() || null,
      shopId,
      shopName: r[MCN_COLUMNS.shopName]?.trim() || null,
      level1Category: r[MCN_COLUMNS.cat1]?.trim() || null,
      level2Category: r[MCN_COLUMNS.cat2]?.trim() || null,
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
    });
  }
  return { rows, skipped, rawHeadersFound };
}

/**
 * Parses the TAP (CSV-2 / agency-link) report into internal rows. Same skip
 * rules as MCN (Summary row, missing product/shop identity).
 */
export async function parseTapFile(file: File): Promise<ParseResult<TapRow>> {
  const { rows: raw, errors } = await parseSheet(file);
  const skipped: SkippedRow[] = errors.map((e) => ({ row: -1, reason: e }));
  const rawHeadersFound = raw.length > 0 ? Object.keys(raw[0]) : [];
  const rows: TapRow[] = [];

  for (const [i, raw0] of raw.entries()) {
    const rowNum = i + 2;
    if (isSummaryRow(raw0)) continue;
    const r = translateRowKeys(raw0, TAP_HEADER_ALIASES);

    const productId = (r[TAP_COLUMNS.productId] ?? "").trim();
    const shopId = (r[TAP_COLUMNS.shopId] ?? "").trim();
    if (!productId || !shopId) {
      skipped.push({ row: rowNum, reason: "ID Produk / ID Toko kosong" });
      continue;
    }
    const creatorName = (r[TAP_COLUMNS.creator] ?? "").trim();
    const range = parsePeriodRange(r[TAP_COLUMNS.date]);

    rows.push({
      periodStart: range?.start ?? null,
      periodEnd: range?.end ?? null,
      creatorName,
      productId,
      productInfo: r[TAP_COLUMNS.productInfo]?.trim() || null,
      shopId,
      shopName: r[TAP_COLUMNS.shopName]?.trim() || null,
      level2Category: r[TAP_COLUMNS.cat2]?.trim() || null,
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
  }
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

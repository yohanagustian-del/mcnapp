import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import Papa from "papaparse";
import { normalizeHeader } from "@/lib/utils/csv";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";

/**
 * Shopee Conversion Report parser (Lane 1, Shopee card — CLAUDE.md task spec).
 * Single combined CSV (MCN + SAP) exported from Shopee Affiliate — one row per
 * order-line, unlike the TikTok MCN report which is already a per-(product,
 * shop, day) aggregate. Only "Selesai" (completed) rows count toward GMV
 * (CLAUDE.md task rule #1); everything else (Pembatalan/Sedang Diproses/...) is
 * parsed but excluded from aggregation, listed in `skipped` for visibility.
 *
 * Deliberately NOT reused: parse.ts's MCN_COLUMNS/TAP_COLUMNS shape (TikTok
 * per-product-aggregate headers) — the Shopee report is a completely different
 * export shape (per-order-line, Indonesian headers only, no ID/EN alias table
 * needed since this file format has always been Indonesian). A dedicated
 * header map keeps this parser simple and independently testable.
 */

/** Normalized (parseSheet/parseCsv already does trim→lowercase→spaces→"_") Shopee headers this module reads. */
export const SHOPEE_COLUMNS = {
  orderStatus: "status_pesanan",
  orderedAt: "waktu_pesanan_dibuat",
  affiliateName: "nama_affiliate",
  affiliateUsername: "username_affiliate",
  productId: "id_produk",
  productName: "nama_produk",
  shopId: "id_toko",
  shopName: "nama_toko",
  cat1: "kategori_l1",
  cat2: "kategori_l2",
  gmv: "total_pembelian_yang_dibuat(rp)",
  platform: "platform",
} as const;

export const SHOPEE_REQUIRED_HEADERS = [
  SHOPEE_COLUMNS.orderStatus,
  SHOPEE_COLUMNS.orderedAt,
  SHOPEE_COLUMNS.affiliateUsername,
  SHOPEE_COLUMNS.gmv,
];

/** One usable row from the Shopee Conversion Report — only rows with Status Pesanan = "Selesai" survive parseShopeeFile. */
export interface ShopeeRow {
  orderDate: string; // "YYYY-MM-DD" — date part of Waktu Pesanan Dibuat (window reference)
  affiliateName: string;
  affiliateUsername: string;
  productId: string;
  productName: string | null;
  shopId: string;
  shopName: string | null;
  level1Category: string | null;
  level2Category: string | null;
  gmv: number;
  /** Raw Platform column value ("Shopeelive-Shopee" / "Shopeevideo-Shopee" / "WhatsApp" / ...). */
  platform: string;
  bucket: "live" | "video" | "other";
}

export interface SkippedShopeeRow {
  row: number; // 1-based data row (header = line 1, first data row = 2); -1 = not row-specific
  reason: string;
}

export interface ShopeeParseResult {
  rows: ShopeeRow[];
  /** Count of rows whose Status Pesanan != "Selesai" (parsed but excluded from GMV, not an error). */
  rowsNonCompleted: number;
  skipped: SkippedShopeeRow[];
  rawHeadersFound: string[];
  /**
   * Set when the Conversion Report header row could not be found: the file's
   * first non-empty line (trimmed to 200 chars), so the error the user sees
   * shows what the file actually starts with.
   */
  headerNotFound?: { firstLine: string };
}

/** Leading non-header lines tolerated before the header (title rows etc.) — same allowance as parseSheet. */
const MAX_PREAMBLE_LINES = 5;

/** True when a raw CSV line looks like the Conversion Report header (any required column present). */
function isHeaderLine(line: string): boolean {
  const cells = line.split(/[,;\t]/).map((c) => normalizeHeader(c.replace(/^\s*"|"\s*$/g, "")));
  return SHOPEE_REQUIRED_HEADERS.some((h) => cells.includes(h));
}

/** Text encoding from the byte-order mark: Excel's "Unicode Text"/UTF-16 saves start with FF FE / FE FF. */
async function detectEncoding(file: File): Promise<"utf-8" | "utf-16le" | "utf-16be"> {
  const b = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xfe) return "utf-16le";
  if (b[0] === 0xfe && b[1] === 0xff) return "utf-16be";
  return "utf-8";
}

/** "Waktu Pesanan Dibuat" is "YYYY-MM-DD HH:MM:SS" — take the date part only. */
function dateOnly(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Platform column → live/video/other bucket (case-insensitive substring match per CLAUDE.md task rule #4). */
function platformBucket(platform: string): "live" | "video" | "other" {
  const p = platform.toLowerCase();
  if (p.includes("live")) return "live";
  if (p.includes("video")) return "video";
  return "other";
}

/**
 * Parses the Shopee Conversion Report CSV (BOM-tolerant, comma-delimited).
 * Skips the leading "Summary"/"Ringkasan" totals row (isSummaryRow convention)
 * and any row missing product/shop identity or an unreadable order date.
 * Only "Selesai" rows are returned in `rows`; other statuses are counted in
 * `rowsNonCompleted` (CLAUDE.md task rule #1 — Pembatalan/Sedang Diproses/dll
 * never contribute to GMV).
 *
 * CSV is parsed STREAMING (Papa step over file.stream()), one row at a time,
 * keeping only the slim ShopeeRow: exports reach 120-200MB (~350k lines x ~57
 * columns), and materializing the text + every raw 57-column row object (the
 * parseSheet path) peaked at ~3.2GB for 200MB — past the serverless function
 * memory. Non-CSV files (.xlsx) still go through parseSheet.
 *
 * Like parseSheet, up to MAX_PREAMBLE_LINES leading lines before the header
 * (e.g. a report title row) are skipped, and a UTF-16 file (Excel re-save) is
 * decoded by its BOM. If no header is found, `headerNotFound` carries the
 * file's first line for the error message.
 */
export async function parseShopeeFile(file: File): Promise<ShopeeParseResult> {
  const skipped: SkippedShopeeRow[] = [];
  const rows: ShopeeRow[] = [];
  let rawHeadersFound: string[] = [];
  let rowsNonCompleted = 0;

  // Values Papa hands back are V8 substrings that pin the whole chunk they were
  // cut from, so keeping ~350k rows would retain the entire file text. intern()
  // copies each distinct value once (Buffer round-trip = a fresh flat string)
  // and shares it — product/shop/creator/category values repeat heavily.
  const pool = new Map<string, string>();
  const intern = (v: string): string => {
    const hit = pool.get(v);
    if (hit !== undefined) return hit;
    const fresh = Buffer.from(v, "utf8").toString("utf8");
    pool.set(fresh, fresh);
    return fresh;
  };
  const opt = (v: string | undefined): string | null => {
    const t = v?.trim();
    return t ? intern(t) : null;
  };

  const consume = (r: Record<string, string>, rowNum: number) => {
    // "Summary"/"Ringkasan" leading totals row (same convention as isSummaryRow,
    // checked inline since this row also usually fails the status check below).
    const status = (r[SHOPEE_COLUMNS.orderStatus] ?? "").trim();
    if (["summary", "ringkasan"].includes(status.toLowerCase())) return;

    if (status !== "Selesai") {
      rowsNonCompleted++;
      return;
    }

    const productId = (r[SHOPEE_COLUMNS.productId] ?? "").trim();
    const shopId = (r[SHOPEE_COLUMNS.shopId] ?? "").trim();
    if (!productId || !shopId) {
      skipped.push({ row: rowNum, reason: "ID Produk / ID Toko kosong (baris Selesai)" });
      return;
    }

    const orderDate = dateOnly(r[SHOPEE_COLUMNS.orderedAt] ?? "");
    if (!orderDate) {
      skipped.push({ row: rowNum, reason: "Waktu Pesanan Dibuat tidak terbaca (baris Selesai)" });
      return;
    }

    const username = (r[SHOPEE_COLUMNS.affiliateUsername] ?? "").trim();
    if (!username) {
      skipped.push({ row: rowNum, reason: "Username Affiliate kosong (baris Selesai)" });
      return;
    }

    const platform = (r[SHOPEE_COLUMNS.platform] ?? "").trim();

    rows.push({
      orderDate: intern(orderDate),
      affiliateName: intern((r[SHOPEE_COLUMNS.affiliateName] ?? "").trim() || username),
      affiliateUsername: intern(username),
      productId: intern(productId),
      productName: opt(r[SHOPEE_COLUMNS.productName]),
      shopId: intern(shopId),
      shopName: opt(r[SHOPEE_COLUMNS.shopName]),
      level1Category: opt(r[SHOPEE_COLUMNS.cat1]),
      level2Category: opt(r[SHOPEE_COLUMNS.cat2]),
      gmv: parseRupiah(r[SHOPEE_COLUMNS.gmv]) ?? 0,
      platform: intern(platform),
      bucket: platformBucket(platform),
    });
  };

  if (!/\.csv$/i.test(file.name)) {
    const { rows: raw, errors } = await parseSheet(file, SHOPEE_REQUIRED_HEADERS);
    skipped.push(...errors.map((e) => ({ row: -1, reason: e })));
    rawHeadersFound = raw.length > 0 ? Object.keys(raw[0]) : [];
    for (const [i, r] of raw.entries()) consume(r, i + 2);
    return { rows, rowsNonCompleted, skipped, rawHeadersFound };
  }

  let headerNotFound: ShopeeParseResult["headerNotFound"];
  const encoding = await detectEncoding(file);

  await new Promise<void>((resolve, reject) => {
    let dataRow = 0;
    let headerChecked = false;
    let firstLine = "";
    // TextDecoderStream keeps multi-byte chars intact across chunk boundaries and
    // drops the BOM (UTF-8 or UTF-16), so Papa only ever sees clean text.
    const text = (file.stream() as unknown as NodeWebReadableStream<Uint8Array>).pipeThrough(
      new TextDecoderStream(encoding) as unknown as import("node:stream/web").TransformStream<Uint8Array, string>
    );
    const input = Readable.fromWeb(text);
    input.on("error", reject);
    Papa.parse<Record<string, string>>(input as unknown as Papa.LocalFile, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: normalizeHeader,
      // Drop title/preamble lines above the header (the first chunk is 64KB,
      // far more than a few header-sized lines).
      beforeFirstChunk: (chunk) => {
        const lines = chunk.split(/\r?\n/, MAX_PREAMBLE_LINES + 1);
        firstLine = (lines.find((l) => l.trim() !== "") ?? "").trim().slice(0, 200);
        const at = lines.findIndex(isHeaderLine);
        if (at <= 0) return chunk;
        let cut = 0;
        for (let i = 0; i < at; i++) cut = chunk.indexOf("\n", cut) + 1;
        return chunk.slice(cut);
      },
      step: (result, parser) => {
        if (!headerChecked) {
          headerChecked = true;
          rawHeadersFound = result.meta.fields ?? [];
          if (!SHOPEE_REQUIRED_HEADERS.some((h) => rawHeadersFound.includes(h))) {
            skipped.push({ row: -1, reason: `Header wajib tidak ditemukan (${SHOPEE_REQUIRED_HEADERS.join(", ")})` });
            headerNotFound = { firstLine };
            rawHeadersFound = [];
            parser.abort();
            return;
          }
        }
        dataRow++;
        for (const e of result.errors) skipped.push({ row: -1, reason: `Baris ${e.row ?? dataRow - 1}: ${e.message}` });
        consume(result.data, dataRow + 1);
      },
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });

  return { rows, rowsNonCompleted, skipped, rawHeadersFound, headerNotFound };
}

export interface ShopeeWindowCheck {
  valid: boolean;
  reason?: string;
  /** Window boundary dates (window start/end, NOT the min/max actual dates found) when valid. */
  periodStart?: string;
  periodEnd?: string;
}

/** Day-of-month → (start,end) of its W1-W5 window, within the SAME calendar month as `day`. */
function windowBoundsFor(year: number, month: number, day: number): { start: number; end: number; week: number } {
  if (day <= 7) return { start: 1, end: 7, week: 1 };
  if (day <= 14) return { start: 8, end: 14, week: 2 };
  if (day <= 21) return { start: 15, end: 21, week: 3 };
  if (day <= 28) return { start: 22, end: 28, week: 4 };
  return { start: 29, end: daysInMonthLocal(year, month), week: 5 };
}

function daysInMonthLocal(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Validates that every "Waktu Pesanan Dibuat" date across all Selesai rows
 * falls within exactly ONE W1-W5 window. The reference date is orderDate
 * (decision 2026-09-30, replacing Waktu Pesanan Selesai): Shopee Affiliate
 * filters the export by order-created date, so an order placed on the 7th but
 * completed on the 13th must still land in W1 — keying on the completion date
 * made every real export span several windows. Unlike the TikTok MCN report
 * whose Date column is already a pre-computed window range. Distinct from validateW1W5Period
 * (src/lib/utils/date.ts), which validates an ALREADY-KNOWN [start,end] window
 * pair — here we must first DERIVE whether the scattered dates in the file
 * collapse into one window, so a bespoke check is needed. On success, returns
 * the window's canonical boundary dates (e.g. "2026-07-01".."2026-07-07"), NOT
 * the min/max actual dates found — this keeps periodStart/periodEnd consistent
 * with the TikTok pipeline's convention (period_start = window start, used as
 * the replace/delete scope key and the W1-W5 day-of-month check downstream).
 */
export function validateSingleShopeeWindow(rows: ShopeeRow[]): ShopeeWindowCheck {
  if (rows.length === 0) {
    return { valid: false, reason: "Tidak ada baris berstatus Selesai pada file ini." };
  }

  const distinctDates = [...new Set(rows.map((r) => r.orderDate))].sort();
  const windowsTouched = new Set<string>();
  let refYear = 0;
  let refMonth = 0;

  for (const d of distinctDates) {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { valid: false, reason: `Tanggal "${d}" tidak valid (format YYYY-MM-DD).` };
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const { start, end, week } = windowBoundsFor(year, month, day);
    windowsTouched.add(`${year}-${pad2(month)}-W${week} (${pad2(month)}/${pad2(start)}-${pad2(end)})`);
    if (refYear === 0) {
      refYear = year;
      refMonth = month;
    }
  }

  const schemeHint =
    "Skema yang benar: W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir bulan (bulan Februari non-kabisat tidak punya W5). " +
    "Semua baris berstatus Selesai harus punya Waktu Pesanan Dibuat dalam SATU window W1-W5 yang sama " +
    "(filter tanggal export Shopee = tanggal pesanan dibuat).";

  if (windowsTouched.size > 1) {
    const windowList = [...windowsTouched].sort().join(", ");
    return {
      valid: false,
      reason:
        `Waktu Pesanan Dibuat baris berstatus Selesai mencakup rentang ${distinctDates[0]} s/d ${distinctDates[distinctDates.length - 1]}, ` +
        `menyentuh lebih dari satu window: ${windowList}. ${schemeHint}`,
    };
  }

  const onlyDate = distinctDates[0];
  const m = onlyDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  const day = Number(m[3]);
  const { start, end } = windowBoundsFor(refYear, refMonth, day);
  const periodStart = `${refYear}-${pad2(refMonth)}-${pad2(start)}`;
  const periodEnd = `${refYear}-${pad2(refMonth)}-${pad2(end)}`;
  return { valid: true, periodStart, periodEnd };
}

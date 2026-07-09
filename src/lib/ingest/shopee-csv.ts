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
  completedAt: "waktu_pesanan_selesai",
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
  SHOPEE_COLUMNS.completedAt,
  SHOPEE_COLUMNS.affiliateUsername,
  SHOPEE_COLUMNS.gmv,
];

/** One usable row from the Shopee Conversion Report — only rows with Status Pesanan = "Selesai" survive parseShopeeFile. */
export interface ShopeeRow {
  completedDate: string; // "YYYY-MM-DD" — date part of Waktu Pesanan Selesai
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
}

/** "Waktu Pesanan Selesai" is "YYYY-MM-DD HH:MM:SS" — take the date part only. */
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
 * Parses the Shopee Conversion Report CSV (BOM-tolerant, comma-delimited —
 * parseSheet/parseCsv already strips BOM via Papaparse and normalizes headers).
 * Skips the leading "Summary"/"Ringkasan" totals row (isSummaryRow convention)
 * and any row missing product/shop identity or an unreadable completed date.
 * Only "Selesai" rows are returned in `rows`; other statuses are counted in
 * `rowsNonCompleted` (CLAUDE.md task rule #1 — Pembatalan/Sedang Diproses/dll
 * never contribute to GMV).
 */
export async function parseShopeeFile(file: File): Promise<ShopeeParseResult> {
  const { rows: raw, errors } = await parseSheet(file, SHOPEE_REQUIRED_HEADERS);
  const skipped: SkippedShopeeRow[] = errors.map((e) => ({ row: -1, reason: e }));
  const rawHeadersFound = raw.length > 0 ? Object.keys(raw[0]) : [];
  const rows: ShopeeRow[] = [];
  let rowsNonCompleted = 0;

  for (const [i, r] of raw.entries()) {
    const rowNum = i + 2;
    // "Summary"/"Ringkasan" leading totals row (same convention as isSummaryRow,
    // checked inline since this row also usually fails the status check below).
    const status = (r[SHOPEE_COLUMNS.orderStatus] ?? "").trim();
    if (["summary", "ringkasan"].includes(status.toLowerCase())) continue;

    if (status !== "Selesai") {
      rowsNonCompleted++;
      continue;
    }

    const productId = (r[SHOPEE_COLUMNS.productId] ?? "").trim();
    const shopId = (r[SHOPEE_COLUMNS.shopId] ?? "").trim();
    if (!productId || !shopId) {
      skipped.push({ row: rowNum, reason: "ID Produk / ID Toko kosong (baris Selesai)" });
      continue;
    }

    const completedDate = dateOnly(r[SHOPEE_COLUMNS.completedAt] ?? "");
    if (!completedDate) {
      skipped.push({ row: rowNum, reason: "Waktu Pesanan Selesai tidak terbaca (baris Selesai)" });
      continue;
    }

    const username = (r[SHOPEE_COLUMNS.affiliateUsername] ?? "").trim();
    if (!username) {
      skipped.push({ row: rowNum, reason: "Username Affiliate kosong (baris Selesai)" });
      continue;
    }

    const platform = (r[SHOPEE_COLUMNS.platform] ?? "").trim();

    rows.push({
      completedDate,
      affiliateName: (r[SHOPEE_COLUMNS.affiliateName] ?? "").trim() || username,
      affiliateUsername: username,
      productId,
      productName: r[SHOPEE_COLUMNS.productName]?.trim() || null,
      shopId,
      shopName: r[SHOPEE_COLUMNS.shopName]?.trim() || null,
      level1Category: r[SHOPEE_COLUMNS.cat1]?.trim() || null,
      level2Category: r[SHOPEE_COLUMNS.cat2]?.trim() || null,
      gmv: parseRupiah(r[SHOPEE_COLUMNS.gmv]) ?? 0,
      platform,
      bucket: platformBucket(platform),
    });
  }

  return { rows, rowsNonCompleted, skipped, rawHeadersFound };
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
 * Validates that every "Waktu Pesanan Selesai" date across all Selesai rows
 * falls within exactly ONE W1-W5 window (CLAUDE.md task rule #2 — the reference
 * date is completedDate, unlike the TikTok MCN report whose Date column is
 * already a pre-computed window range). Distinct from validateW1W5Period
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

  const distinctDates = [...new Set(rows.map((r) => r.completedDate))].sort();
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
    "Semua baris berstatus Selesai harus berada dalam SATU window W1-W5 yang sama.";

  if (windowsTouched.size > 1) {
    const windowList = [...windowsTouched].sort().join(", ");
    return {
      valid: false,
      reason:
        `Baris berstatus Selesai mencakup rentang tanggal ${distinctDates[0]} s/d ${distinctDates[distinctDates.length - 1]}, ` +
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

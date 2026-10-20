import * as XLSX from "xlsx";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";
import { normalizeDealStatus, type DealStatus } from "./deal-status";

/**
 * Import Bulk Deal Brand (keputusan user 2026-10-20, docs/DECISIONS.md D-2026-10-20-*).
 *
 * Sumber: Google Sheet "All Brand TAP [Database Bizdev TikTok 2026]", tab
 * "DATA BULKING! UNTUK KO YOHAN". Baris 1 = grup kolom (Bizdev A–P, Campaign Ops Q–V),
 * baris 2 = header. Header "Leads" muncul DUA kali (kolom C = tahap pipeline, kolom N =
 * sumber leads), jadi kolom dipetakan per POSISI, bukan per nama header.
 *
 * Satu file = daftar kolom + parser + template/export .xlsx, dijaga test round-trip —
 * jangan menulis header di tempat lain. Pure (tanpa DB): pencocokan nama anggota tim,
 * Project BD, dan diff produksi terjadi di server action / script dry-run.
 */

export type BulkDealColumnKey =
  | "brandName" | "bizdev" | "pipelineStage" | "status" | "niche" | "brandLink" | "shopId"
  | "contactPic" | "namaGrup" | "gmvTap" | "avgPrice" | "supportTypes" | "adsBrand"
  | "leadsType" | "priority" | "workingSheet" | "campaignOps" | "campaignName" | "campaignId"
  | "expDate" | "countdown" | "shopCode";

export interface BulkDealColumn {
  key: BulkDealColumnKey;
  /** Header persis seperti di sheet (termasuk spasi di ujung "Campaign Name "). */
  header: string;
  group: "Bizdev" | "Campaign Ops";
}

/** Urutan = posisi kolom A..V di sheet. */
export const BULK_DEAL_COLUMNS: BulkDealColumn[] = [
  { key: "brandName", header: "Nama Brand (WAJIB SESUAI DISPLAY PLATFORM)", group: "Bizdev" },
  { key: "bizdev", header: "Bizdev", group: "Bizdev" },
  { key: "pipelineStage", header: "Leads", group: "Bizdev" },
  { key: "status", header: "Status", group: "Bizdev" },
  { key: "niche", header: "NIche", group: "Bizdev" },
  { key: "brandLink", header: "Link Toko Seller / Brand", group: "Bizdev" },
  { key: "shopId", header: "SHOP ID", group: "Bizdev" },
  { key: "contactPic", header: "Contact PIC Brand", group: "Bizdev" },
  { key: "namaGrup", header: "Grup Brand", group: "Bizdev" },
  { key: "gmvTap", header: "GMV TAP", group: "Bizdev" },
  { key: "avgPrice", header: "Avg Harga Product", group: "Bizdev" },
  { key: "supportTypes", header: "Sample, Flash Sale & Ads", group: "Bizdev" },
  { key: "adsBrand", header: "Ads Brand", group: "Bizdev" },
  { key: "leadsType", header: "Leads", group: "Bizdev" },
  { key: "priority", header: "Priority", group: "Bizdev" },
  { key: "workingSheet", header: "Working Sheet", group: "Bizdev" },
  { key: "campaignOps", header: "Campaign Ops", group: "Campaign Ops" },
  { key: "campaignName", header: "Campaign Name ", group: "Campaign Ops" },
  { key: "campaignId", header: "Campaign ID", group: "Campaign Ops" },
  { key: "expDate", header: "Exp Date", group: "Campaign Ops" },
  { key: "countdown", header: "Countdown", group: "Campaign Ops" },
  { key: "shopCode", header: "Shop Code", group: "Campaign Ops" },
];

export const BULK_DEAL_EXPORT_FILENAME = "bulk_deal_brand.xlsx";
export const BULK_DEAL_SHEET_NAME = "DATA BULKING";

/** "Non BD Hande" (ejaan sheet) — penanda tanpa handler, bukan nama anggota tim. */
export const NON_BD_LABELS = ["non bd hande", "non bd handle"];
export const NON_CAMPAIGN_OPS_LABEL = "non campaign ops";
export const MAX_BULK_BIZDEV = 2;

export const SUPPORT_TYPES = ["sample", "flash_sale", "ads"] as const;
export type SupportType = (typeof SUPPORT_TYPES)[number];
const SUPPORT_LABEL: Record<SupportType, string> = { sample: "Sample", flash_sale: "Flash Sale", ads: "Ads" };

const canon = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const cell = (row: string[], i: number) => String(row[i] ?? "").trim();

export interface BulkDealRow {
  /** Nomor baris di sheet (1-based, baris 1 = grup kolom). */
  sheetRow: number;
  brandName: string;
  shopId: string;
  /** Teks asli kolom Bizdev (mis. "Non BD Hande") — disimpan sebagai brand_deals.bizdev_label. */
  bizdevLabel: string | null;
  /** Nama BizDev (maks 2) — dicocokkan ke team_members di server. Kosong untuk "Non BD Hande". */
  bizdevNames: string[];
  statusRaw: string;
  status: DealStatus | null;
  niche: string | null;
  brandLink: string | null;
  contactPic: string | null;
  namaGrup: string | null;
  gmvTap: number | null;
  avgPrice: number | null;
  supportTypes: SupportType[] | null;
  /** Nilai mentah Ads Brand (kolom deprecated brand_deals.ads_brand). */
  adsBrand: string | null;
  leadsType: string | null;
  priority: string | null;
  workingSheet: string | null;
  /** Nama Campaign Ops; null untuk "Non Campaign Ops"/kosong. */
  campaignOpsName: string | null;
  campaignName: string | null;
  campaignId: string | null;
  expDate: string | null;
  shopCode: string | null;
  /** Isi kolom tanpa header di kanan tabel (mis. catatan) → notes. */
  extraNote: string | null;
  /** Masalah per baris yang tidak membuatnya di-skip (dilaporkan). */
  warnings: string[];
}

export type BulkSkipReason = "duplikat_persis" | "tanpa_shop_id" | "tanpa_nama_brand";

export interface BulkDealSkip {
  sheetRow: number;
  brandName: string;
  shopId: string;
  reason: BulkSkipReason;
  /** Baris lain di sheet dengan kunci yang sama (khusus duplikat). */
  otherRows?: number[];
}

export interface BulkDealParseResult {
  rows: BulkDealRow[];
  skipped: BulkDealSkip[];
  /** Header salah / bukan sheet yang diharapkan → seluruh file ditolak. */
  errors: string[];
  /** Nomor baris header di file (1-based). */
  headerRow: number;
}

export const SKIP_REASON_LABEL: Record<BulkSkipReason, string> = {
  duplikat_persis: "Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim",
  tanpa_shop_id: "Tanpa Shop ID — perlu konfirmasi tim",
  tanpa_nama_brand: "Tanpa nama brand",
};

/** Kunci upsert (platform, shop_id, trim(brand_name)) — case-sensitive (DECISIONS D-4). */
export function bulkDealKey(shopId: string, brandName: string): string {
  return `${shopId.trim()}\u0000${brandName.trim()}`;
}

/** Baca file (.xlsx/.csv) mentah sebagai matriks string, tanpa menormalisasi header. */
export function readSheetMatrix(data: ArrayBuffer | Uint8Array | string, fileName: string): string[][] {
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  const wb =
    typeof data === "string"
      ? XLSX.read(data, { type: "string", raw: true })
      : isCsv
        ? XLSX.read(new TextDecoder("utf-8").decode(data), { type: "string", raw: true })
        : XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  return rows.map((r) => r.map((v) => String(v ?? "")));
}

function findHeaderRow(matrix: string[][]): number {
  for (let i = 0; i < Math.min(5, matrix.length); i++) {
    if (canon(cell(matrix[i], 0)).startsWith("namabrand")) return i;
  }
  return -1;
}

export function parseSupportTypes(raw: string): { types: SupportType[] | null; unknown: string[] } {
  const found = new Set<SupportType>();
  const unknown: string[] = [];
  for (const part of raw.split(/[,;/&]+/)) {
    const c = canon(part);
    if (!c) continue;
    if (c === "sample" || c === "sampel") found.add("sample");
    else if (c === "flashsale") found.add("flash_sale");
    else if (c === "ads") found.add("ads");
    else unknown.push(part.trim());
  }
  // Urutan sheet acak ("Sample, Ads, Flash Sale") → urutan baku.
  const types = SUPPORT_TYPES.filter((t) => found.has(t));
  return { types: types.length ? types : null, unknown };
}

export function formatSupportTypes(types: readonly string[] | null | undefined): string {
  return (types ?? []).map((t) => SUPPORT_LABEL[t as SupportType] ?? t).join(", ");
}

export function parseBizdev(raw: string): { label: string | null; names: string[] } {
  const label = raw.trim() || null;
  if (!label || NON_BD_LABELS.includes(label.toLowerCase())) return { label, names: [] };
  const names = [...new Set(label.split(",").map((n) => n.trim()).filter(Boolean))];
  return { label, names };
}

const nullIfBlank = (s: string) => (s === "" || s === "-" ? null : s);

/**
 * Parse matriks sheet → baris siap simpan + daftar skip. Aturan (DECISIONS D-2026-10-20-4):
 * - tanpa nama brand / tanpa Shop ID → skip + lapor;
 * - duplikat persis (nama setelah trim + Shop ID sama) → SEMUA baris kelompok itu di-skip
 *   dan dilaporkan; tim yang memutuskan baris mana yang benar (tidak menebak);
 * - Shop ID sama dengan nama berbeda (termasuk beda huruf besar/kecil) = brand terpisah.
 */
export function parseBulkDealMatrix(matrix: string[][]): BulkDealParseResult {
  const errors: string[] = [];
  const h = findHeaderRow(matrix);
  if (h < 0) {
    return {
      rows: [], skipped: [], headerRow: 0,
      errors: ['Header tidak ditemukan — kolom A harus "Nama Brand (WAJIB SESUAI DISPLAY PLATFORM)".'],
    };
  }
  const header = matrix[h];
  for (const [i, col] of BULK_DEAL_COLUMNS.entries()) {
    if (canon(cell(header, i)) !== canon(col.header)) {
      errors.push(
        `Kolom ${XLSX.utils.encode_col(i)} harus "${col.header.trim()}", ditemukan "${cell(header, i)}". ` +
          "Kolom dipetakan per posisi — jangan menggeser urutan kolom."
      );
    }
  }
  if (errors.length) return { rows: [], skipped: [], errors, headerRow: h + 1 };

  const extraCols = header.length > BULK_DEAL_COLUMNS.length;
  const parsed: BulkDealRow[] = [];
  const skipped: BulkDealSkip[] = [];

  for (let i = h + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (r.every((v) => !String(v).trim())) continue;
    const sheetRow = i + 1;
    const brandName = cell(r, 0);
    const shopId = cell(r, 6);
    if (!brandName) {
      skipped.push({ sheetRow, brandName, shopId, reason: "tanpa_nama_brand" });
      continue;
    }
    if (!shopId) {
      skipped.push({ sheetRow, brandName, shopId, reason: "tanpa_shop_id" });
      continue;
    }

    const warnings: string[] = [];
    if (!/^\d+$/.test(shopId)) warnings.push(`Shop ID bukan angka: "${shopId}"`);

    const bizdev = parseBizdev(cell(r, 1));
    if (bizdev.names.length > MAX_BULK_BIZDEV) {
      warnings.push(`Bizdev lebih dari ${MAX_BULK_BIZDEV}: ${bizdev.names.join(", ")} — hanya 2 pertama yang dipasang`);
    }

    const statusRaw = cell(r, 3);
    const status = normalizeDealStatus(statusRaw);
    if (!statusRaw) warnings.push("Status kosong → disimpan NULL");
    else if (!status) warnings.push(`Status tidak dikenal: "${statusRaw}" → disimpan NULL`);

    const gmvRaw = cell(r, 9);
    const gmvTap = parseRupiah(gmvRaw);
    if (nullIfBlank(gmvRaw) && gmvTap === null) warnings.push(`GMV TAP tidak terbaca: "${gmvRaw}"`);
    const avgRaw = cell(r, 10);
    const avgPrice = parseRupiah(avgRaw);
    if (nullIfBlank(avgRaw) && avgPrice === null) warnings.push(`Avg Harga tidak terbaca: "${avgRaw}"`);

    const support = parseSupportTypes(cell(r, 11));
    if (support.unknown.length) warnings.push(`Sample/Flash Sale/Ads tidak dikenal: ${support.unknown.join(", ")}`);

    const expRaw = cell(r, 19);
    const expDate = parseFlexibleDate(expRaw);
    if (nullIfBlank(expRaw) && !expDate) warnings.push(`Exp Date tidak terbaca: "${expRaw}"`);
    const slash = expRaw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}$/);
    if (slash && Number(slash[1]) <= 12 && Number(slash[2]) <= 12 && slash[1] !== slash[2]) {
      warnings.push(`Exp Date "${expRaw}" ambigu (dibaca hari/bulan → ${expDate}) — mohon cek`);
    }

    const ops = cell(r, 16);
    const extra = extraCols ? r.slice(BULK_DEAL_COLUMNS.length).map((v) => String(v).trim()).filter(Boolean) : [];

    parsed.push({
      sheetRow,
      brandName,
      shopId,
      bizdevLabel: bizdev.label,
      bizdevNames: bizdev.names.slice(0, MAX_BULK_BIZDEV),
      statusRaw,
      status,
      niche: nullIfBlank(cell(r, 4)),
      brandLink: nullIfBlank(cell(r, 5)),
      contactPic: nullIfBlank(cell(r, 7)),
      namaGrup: nullIfBlank(cell(r, 8)),
      gmvTap,
      avgPrice,
      supportTypes: support.types,
      adsBrand: nullIfBlank(cell(r, 12)),
      leadsType: nullIfBlank(cell(r, 13)),
      priority: nullIfBlank(cell(r, 14)),
      workingSheet: nullIfBlank(cell(r, 15)),
      campaignOpsName: !ops || ops.toLowerCase() === NON_CAMPAIGN_OPS_LABEL ? null : ops,
      campaignName: nullIfBlank(cell(r, 17)),
      campaignId: nullIfBlank(cell(r, 18)),
      expDate,
      shopCode: nullIfBlank(cell(r, 21)),
      extraNote: extra.length ? extra.join("; ") : null,
      warnings,
    });
  }

  // Duplikat persis: semua anggota kelompok di-skip.
  const groups = new Map<string, BulkDealRow[]>();
  for (const row of parsed) {
    const k = bulkDealKey(row.shopId, row.brandName);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const rows: BulkDealRow[] = [];
  for (const row of parsed) {
    const group = groups.get(bulkDealKey(row.shopId, row.brandName))!;
    if (group.length === 1) {
      rows.push(row);
      continue;
    }
    skipped.push({
      sheetRow: row.sheetRow,
      brandName: row.brandName,
      shopId: row.shopId,
      reason: "duplikat_persis",
      otherRows: group.map((g) => g.sheetRow).filter((n) => n !== row.sheetRow),
    });
  }
  skipped.sort((a, b) => a.sheetRow - b.sheetRow);
  return { rows, skipped, errors, headerRow: h + 1 };
}

/** Nilai di luar daftar app_config — dilaporkan, tidak dipetakan (DECISIONS D-2/D-3/D-7). */
export function outOfListValues(
  rows: BulkDealRow[],
  field: "adsBrand" | "leadsType" | "niche",
  options: readonly string[]
): { sheetRow: number; brandName: string; shopId: string; value: string }[] {
  const allowed = new Set(options.map((o) => o.trim()));
  return rows
    .filter((r) => r[field] !== null && !allowed.has(r[field]!))
    .map((r) => ({ sheetRow: r.sheetRow, brandName: r.brandName, shopId: r.shopId, value: r[field]! }));
}

/** Export .xlsx dengan DUA baris header persis sheet sumber (grup + header). */
export function buildBulkDealWorkbook(records: Record<BulkDealColumnKey, string | number | null>[]): XLSX.WorkBook {
  const aoa: (string | number)[][] = [
    BULK_DEAL_COLUMNS.map((c) => c.group),
    BULK_DEAL_COLUMNS.map((c) => c.header),
    ...records.map((rec) => BULK_DEAL_COLUMNS.map((c) => rec[c.key] ?? "")),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), BULK_DEAL_SHEET_NAME);
  return wb;
}

/** Baris tersimpan (format sheet) — dipakai export & round-trip test. */
export function bulkRowToRecord(row: BulkDealRow, campaignOps: string | null): Record<BulkDealColumnKey, string | number | null> {
  return {
    brandName: row.brandName,
    bizdev: row.bizdevLabel,
    pipelineStage: "Deal",
    status: row.statusRaw || null,
    niche: row.niche,
    brandLink: row.brandLink,
    shopId: row.shopId,
    contactPic: row.contactPic,
    namaGrup: row.namaGrup,
    gmvTap: row.gmvTap,
    avgPrice: row.avgPrice,
    supportTypes: formatSupportTypes(row.supportTypes) || null,
    adsBrand: row.adsBrand,
    leadsType: row.leadsType,
    priority: row.priority,
    workingSheet: row.workingSheet,
    campaignOps: campaignOps ?? "Non Campaign Ops",
    campaignName: row.campaignName,
    campaignId: row.campaignId,
    expDate: row.expDate,
    countdown: null, // rumus di sheet — dihitung saat render, tidak disimpan
    shopCode: row.shopCode,
  };
}

/** Countdown (hari menuju exp_date) dihitung saat render, tidak disimpan. */
export function countdownDays(expDate: string | null, today: string): number | null {
  if (!expDate) return null;
  const ms = Date.parse(`${expDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

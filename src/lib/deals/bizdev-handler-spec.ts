import * as XLSX from "xlsx";

/**
 * BizDev penanggung jawab brand (REVISI_BIZDEV T5, keputusan Q1): maks 2 BizDev per
 * shop_key, diisi lewat tombol per baris di tab Deal Brand, pertanyaan opsional di
 * Registrasi Deal, ATAU upload Excel massal. Brand tanpa handler = "Non BD Handle".
 *
 * Satu file = kolom template + parser + template .xlsx (pola partnership-spec.ts),
 * dijaga test round-trip — jangan menulis header template di tempat lain.
 * Pure (no DB): pencocokan shop/anggota tim terjadi di server action.
 */

export const MAX_BIZDEV_HANDLERS = 2;
export const NON_BD_HANDLE_LABEL = "Non BD Handle";

export type BizdevHandlerColumnKey = "shopId" | "shopName" | "bizdev1" | "bizdev2";

export interface BizdevHandlerColumn {
  key: BizdevHandlerColumnKey;
  label: string;
  /** Canonical (a-z0-9) header spellings accepted when reading. */
  aliases: string[];
  note: string;
}

/** Order = template column order. */
export const BIZDEV_HANDLER_COLUMNS: BizdevHandlerColumn[] = [
  {
    key: "shopId",
    label: "Shop ID",
    aliases: ["shopid", "idtoko", "idshop"],
    note: "Dicocokkan lebih dulu (angka). Kosong = dicari lewat Shop Name.",
  },
  {
    key: "shopName",
    label: "Shop Name",
    aliases: ["shopname", "namatoko", "namashop", "brand", "namabrand"],
    note: "Dipakai bila Shop ID kosong / tidak ditemukan. Tidak peka huruf besar/kecil.",
  },
  {
    key: "bizdev1",
    label: "BizDev 1",
    aliases: ["bizdev1", "bizdev", "bd1", "bd"],
    note: "Nama anggota tim ber-role BizDev persis seperti di menu Tim (tidak peka huruf besar/kecil).",
  },
  {
    key: "bizdev2",
    label: "BizDev 2",
    aliases: ["bizdev2", "bd2"],
    note: "Opsional. Maksimal 2 BizDev per brand.",
  },
];

/** parseSheet header probe (normalized form). */
export const BIZDEV_HANDLER_REQUIRED_HEADERS = ["shop_id", "shop_name"];

export const BIZDEV_HANDLER_TEMPLATE_FILENAME = "template_bizdev_handler.xlsx";

const canonicalHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function cell(row: Record<string, string>, column: BizdevHandlerColumn): string {
  for (const [key, value] of Object.entries(row)) {
    if (column.aliases.includes(canonicalHeader(key))) return String(value ?? "").trim();
  }
  return "";
}

const COL = Object.fromEntries(BIZDEV_HANDLER_COLUMNS.map((c) => [c.key, c])) as Record<
  BizdevHandlerColumnKey,
  BizdevHandlerColumn
>;

export interface ParsedBizdevHandlerRow {
  rowNumber: number;
  shopId: string | null;
  shopName: string | null;
  /** Nama BizDev yang diisi (urut, tanpa duplikat). Kosong = baris tidak mengubah apa pun. */
  names: string[];
  /** Fatal: baris dilewati. */
  error: string | null;
}

/** Shop ID: angka saja ("7495…" atau "7.495E+18" ditolak — notasi ilmiah kehilangan digit). */
function parseShopId(raw: string): { value: string | null; error: string | null } {
  const t = raw.replace(/\s/g, "");
  if (!t) return { value: null, error: null };
  if (/^\d+$/.test(t)) return { value: t, error: null };
  if (/e\+?\d+$/i.test(t)) {
    return { value: null, error: `Shop ID "${raw}" berformat notasi ilmiah — ubah kolom jadi Teks di Excel lalu isi ulang.` };
  }
  return { value: null, error: `Shop ID "${raw}" bukan angka.` };
}

/**
 * Sheet rows (headers normalized by parseSheet) → parsed rows. Never throws on dirty
 * input (CLAUDE.md #7). Kedua sel BizDev kosong = baris tidak mengubah assignment lama
 * (Q1 "sel kosong = tidak mengubah"); bila ada isinya, nama-nama itu = keadaan akhir.
 */
export function buildBizdevHandlerRows(rows: Record<string, string>[]): ParsedBizdevHandlerRow[] {
  const out: ParsedBizdevHandlerRow[] = [];
  rows.forEach((row, i) => {
    if (Object.values(row).every((v) => !String(v ?? "").trim())) return;
    const rowNumber = i + 2;
    const shopIdCell = parseShopId(cell(row, COL.shopId));
    const shopName = cell(row, COL.shopName) || null;
    const names: string[] = [];
    for (const raw of [cell(row, COL.bizdev1), cell(row, COL.bizdev2)]) {
      const n = raw.replace(/\s+/g, " ").trim();
      if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    let error: string | null = null;
    if (shopIdCell.error && !shopName) error = shopIdCell.error;
    else if (!shopIdCell.value && !shopName) error = "Shop ID dan Shop Name kosong — baris dilewati.";
    out.push({ rowNumber, shopId: shopIdCell.value, shopName, names, error });
  });
  return out;
}

/** Validasi daftar akhir handler satu brand (dipakai form per baris, Registrasi Deal, upload). */
export function validateHandlerIds(ids: string[]): string | null {
  if (new Set(ids).size !== ids.length) return "BizDev yang sama dipilih dua kali.";
  if (ids.length > MAX_BIZDEV_HANDLERS) return `Maksimal ${MAX_BIZDEV_HANDLERS} BizDev per brand.`;
  return null;
}

/** Sinkron sebagai SELISIH (hapus yang keluar + tambah yang masuk), bukan hapus-lalu-tulis-ulang. */
export function diffHandlers(current: string[], next: string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current);
  const nxt = new Set(next);
  return {
    add: next.filter((id) => !cur.has(id)),
    remove: current.filter((id) => !nxt.has(id)),
  };
}

/**
 * Template upload (.xlsx) dari BIZDEV_HANDLER_COLUMNS — daftar yang sama dengan yang
 * dibaca parser. Sheet "BizDev Handler" (header + baris kosong) + "Petunjuk".
 */
export function buildBizdevHandlerTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const header = BIZDEV_HANDLER_COLUMNS.map((c) => c.label);
  const sheet = XLSX.utils.aoa_to_sheet([header, header.map(() => ""), header.map(() => "")]);
  sheet["!cols"] = BIZDEV_HANDLER_COLUMNS.map((c) => ({ wch: Math.max(16, c.label.length + 6) }));
  XLSX.utils.book_append_sheet(wb, sheet, "BizDev Handler");

  const guide: string[][] = [
    ["PETUNJUK PENGISIAN TEMPLATE BIZDEV HANDLER"],
    [],
    ["Satu baris = satu brand/shop. Isi data mulai baris ke-2 di sheet 'BizDev Handler'."],
    ["Shop dicari lewat Shop ID dulu, lalu Shop Name. Shop yang tidak ditemukan DILEWATI (tidak dibuat baru)."],
    ["Nama BizDev yang tidak dikenal (bukan anggota tim ber-role BizDev) DILEWATI dan ditampilkan sebagai peringatan."],
    [`Maksimal ${MAX_BIZDEV_HANDLERS} BizDev per brand. Nama yang diisi menggantikan BizDev lama brand itu.`],
    ["Baris yang kedua kolom BizDev-nya kosong TIDAK mengubah BizDev lama."],
    [`Brand tanpa BizDev tampil sebagai "${NON_BD_HANDLE_LABEL}".`],
    [],
    ["Kolom", "Keterangan"],
    ...BIZDEV_HANDLER_COLUMNS.map((c) => [c.label, c.note]),
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guide);
  guideSheet["!cols"] = [{ wch: 16 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "Petunjuk");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

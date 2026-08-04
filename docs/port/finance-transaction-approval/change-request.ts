/**
 * PORTABLE — logika pengajuan perubahan transaksi finance.
 *
 * Versi lepas dari `src/lib/finance/change-request.ts` + `transaction.ts`: NOL import,
 * termasuk parseRupiah yang di-inline di bawah. Copy satu file ini ke app tujuan
 * (mis. `lib/finance/change-request.ts`) dan file ini langsung jalan — tidak ada
 * alias `@/`, tidak ada dependensi paket.
 *
 * Semua di sini pure & deterministik (tanpa I/O, tanpa LLM) sehingga bisa diuji
 * tanpa database. Yang menyentuh DB hanya server action host — lihat README §3.
 */

// ============================================================
// Enum & label
// ============================================================

export const PAYMENT_METHODS = [
  "transfer_bank", "virtual_account", "ewallet", "qris", "kartu_kredit", "tunai", "potong_komisi",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer_bank: "Transfer Bank",
  virtual_account: "Virtual Account",
  ewallet: "E-Wallet",
  qris: "QRIS",
  kartu_kredit: "Kartu Kredit",
  tunai: "Tunai",
  potong_komisi: "Potong Komisi Kreator",
};

export const PAYMENT_TERMS = ["lunas", "invoice"] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];
export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  lunas: "Lunas (bayar di muka)",
  invoice: "Invoice (termin)",
};

export const PAYMENT_STATUSES = ["pending", "partial", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Belum Dibayar",
  partial: "Dibayar Sebagian",
  paid: "Lunas",
};

export const TXN_DIRECTIONS = ["masuk", "keluar"] as const;
export type TxnDirection = (typeof TXN_DIRECTIONS)[number];
export const TXN_DIRECTION_LABELS: Record<TxnDirection, string> = {
  masuk: "Uang Masuk (klien → agency)",
  keluar: "Uang Keluar (agency → kreator/vendor)",
};

export const CHANGE_STATUSES = ["menunggu", "approved", "ditolak", "dibatalkan"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export interface FinanceTransaction {
  id: string;
  direction: TxnDirection;
  client_name: string;
  deal_id: string | null;
  creator_id: string | null;
  project_id: number | null;
  invoice_no: string | null;
  amount: number;
  payment_method: PaymentMethod;
  payment_terms: PaymentTerms;
  payment_status: PaymentStatus;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Nomor transaksi TRX-YYYYMM-NNNN
// ============================================================
// Nomor urut diambil di DB (next_finance_trx_id + advisory lock) supaya dua request
// bersamaan tidak dapat nomor sama. Fungsi di sini hanya memformat & memvalidasi.

/** Periode dari tanggal: 2026-08-04 → "202608". */
export function trxPeriod(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new Error("Tanggal transaksi tidak valid");
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** ("202608", 1) → "TRX-202608-0001". Cermin next_finance_trx_id() di DB. */
export function formatTrxId(period: string, seq: number): string {
  if (!/^\d{6}$/.test(period)) throw new Error(`Periode transaksi harus YYYYMM, dapat "${period}"`);
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`Nomor urut transaksi tidak valid: ${seq}`);
  return `TRX-${period}-${String(seq).padStart(4, "0")}`;
}

/** "TRX-202608-0001" → { period, seq }; null kalau bukan nomor transaksi. */
export function parseTrxId(id: string): { period: string; seq: number } | null {
  const m = /^TRX-(\d{6})-(\d{4,})$/.exec(id.trim());
  return m ? { period: m[1], seq: Number(m[2]) } : null;
}

// ============================================================
// parseRupiah — DI-INLINE supaya file ini nol dependensi
// ============================================================

/**
 * Parser Rupiah toleran untuk format campuran yang nyata dipakai orang:
 *  "Rp1,075,484,867" (koma=ribuan) · "Rp4.131.512.642" (titik=ribuan)
 *  "Rp1.234.567,89"  (titik=ribuan, koma=desimal) · "1234567"
 * Return null untuk input kosong/tak terbaca (pemanggil yang memutuskan sikapnya).
 */
export function parseRupiah(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = raw.trim();
  if (s === "" || s === "-") return null;

  let negative = false;
  if (s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"))) {
    negative = true;
    s = s.replace(/^[-(]+|\)+$/g, "");
  }
  s = s.replace(/rp\.?/gi, "").replace(/\s/g, "");
  if (s === "" || !/^[\d.,]+$/.test(s)) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  let normalized: string;

  if (hasDot && hasComma) {
    // Separator terakhir menang sebagai desimal; yang lain = ribuan.
    normalized = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = s.split(sep);
    const groupedAsThousands =
      parts.length > 1 &&
      parts.slice(1).every((p) => p.length === 3) &&
      parts[0].length >= 1 && parts[0].length <= 3;
    if (groupedAsThousands) normalized = parts.join("");
    else if (parts.length === 2 && parts[1].length <= 2) normalized = `${parts[0]}.${parts[1]}`;
    else return null;
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ============================================================
// Field yang boleh diajukan berubah
// ============================================================
// WAJIB sama dengan whitelist di apply_finance_change() (migration.sql §7). Kalau
// kedua daftar melenceng, pengajuan bisa lolos di UI lalu ditolak DB — atau lebih
// buruk, kolom yang tak diniatkan jadi bisa diubah.
export const EDITABLE_FIELDS = [
  "direction", "client_name", "deal_id", "creator_id", "project_id", "invoice_no",
  "amount", "payment_method", "payment_terms", "payment_status",
  "bank_name", "bank_account_no", "bank_account_name", "due_date", "paid_at", "notes",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABELS: Record<EditableField, string> = {
  direction: "Arah Transaksi",
  client_name: "Nama Klien / Brand",
  deal_id: "Deal Terkait",
  creator_id: "Kreator Terkait",
  project_id: "Project Terkait",
  invoice_no: "Nomor Invoice",
  amount: "Nominal",
  payment_method: "Metode Pembayaran",
  payment_terms: "Termin Pembayaran",
  payment_status: "Status Pembayaran",
  bank_name: "Bank Tujuan",
  bank_account_no: "Nomor Rekening",
  bank_account_name: "Nama Pemilik Rekening",
  due_date: "Jatuh Tempo",
  paid_at: "Tanggal Dibayar",
  notes: "Keterangan",
};

export type FieldValue = string | number | null;
export interface FieldChange { before: FieldValue; after: FieldValue }
export type ChangeSet = Partial<Record<EditableField, FieldChange>>;

export function isEditableField(field: string): field is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(field);
}

const ENUM_VALUES: Partial<Record<EditableField, readonly string[]>> = {
  direction: TXN_DIRECTIONS,
  payment_method: PAYMENT_METHODS,
  payment_terms: PAYMENT_TERMS,
  payment_status: PAYMENT_STATUSES,
};
const NUMERIC_FIELDS: EditableField[] = ["amount", "project_id"];
const DATE_FIELDS: EditableField[] = ["due_date", "paid_at"];
/** Mengosongkan field ini bukan "perubahan" — itu merusak baris. */
const REQUIRED_FIELDS: EditableField[] = [
  "direction", "client_name", "amount", "payment_method", "payment_terms", "payment_status",
];

/**
 * Input form (selalu string) → nilai typed yang sebanding dengan kolom DB.
 * Melempar error berbahasa manusia untuk input tak valid: pengajuan perubahan
 * pembayaran tidak boleh "diam-diam null" seperti ingest sheet warisan.
 */
export function normalizeFieldValue(field: EditableField, raw: unknown): FieldValue {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();

  if (s === "") {
    if (REQUIRED_FIELDS.includes(field)) throw new Error(`${FIELD_LABELS[field]} wajib diisi`);
    return null;
  }

  const allowed = ENUM_VALUES[field];
  if (allowed) {
    if (!allowed.includes(s)) throw new Error(`${FIELD_LABELS[field]} tidak valid: "${s}"`);
    return s;
  }

  if (NUMERIC_FIELDS.includes(field)) {
    const n = field === "amount" ? parseRupiah(s) : Number(s);
    if (n === null || !Number.isFinite(n)) {
      throw new Error(`${FIELD_LABELS[field]} bukan angka yang valid: "${s}"`);
    }
    if (n < 0) throw new Error(`${FIELD_LABELS[field]} tidak boleh negatif`);
    return field === "project_id" ? Math.trunc(n) : n;
  }

  if (DATE_FIELDS.includes(field)) {
    // Date picker mengirim YYYY-MM-DD. Teks bebas ("19 February 2026") DITOLAK di sini —
    // form finance wajib tervalidasi, bukan free-text.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      throw new Error(`${FIELD_LABELS[field]} harus tanggal (YYYY-MM-DD), dapat "${s}"`);
    }
    if (Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
      throw new Error(`${FIELD_LABELS[field]} bukan tanggal yang ada: "${s}"`);
    }
    return s;
  }

  return s;
}

function currentValue(txn: FinanceTransaction, field: EditableField): FieldValue {
  const v = (txn as unknown as Record<string, unknown>)[field];
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : String(v);
}

/**
 * Usulan (sudah dinormalisasi) vs transaksi sekarang → hanya field yang BERUBAH.
 * Field yang dikirim form tapi nilainya sama tidak ikut, supaya Director tidak
 * pernah diminta menyetujui perubahan kosong.
 */
export function diffTransaction(
  txn: FinanceTransaction,
  proposed: Partial<Record<EditableField, FieldValue>>,
): ChangeSet {
  const diff: ChangeSet = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in proposed)) continue;
    const after = proposed[field] ?? null;
    const before = currentValue(txn, field);
    // Nominal dibandingkan sebagai angka: "1000000" dari form vs 1000000 dari DB
    // bukan perubahan (beda representasi, bukan beda nilai).
    const same =
      typeof before === "number" || typeof after === "number"
        ? Number(before ?? NaN) === Number(after ?? NaN) || (before === null && after === null)
        : before === after;
    if (!same) diff[field] = { before, after };
  }
  return diff;
}

export interface PartitionedChanges {
  /** Butuh approval Director sebelum berlaku. */
  guarded: ChangeSet;
  /** Berlaku langsung + audit. */
  free: ChangeSet;
}

/**
 * Pecah changeset memakai daftar field terkunci dari config.
 * `guardedFields` HARUS dibaca runtime dari `app_config finance.guarded_fields` —
 * kalau di-hardcode di pemanggil, config di DB jadi bohong dan trigger akan menolak
 * perubahan yang UI kira bebas.
 */
export function partitionChanges(diff: ChangeSet, guardedFields: readonly string[]): PartitionedChanges {
  const guarded: ChangeSet = {};
  const free: ChangeSet = {};
  for (const [field, change] of Object.entries(diff) as [EditableField, FieldChange][]) {
    if (guardedFields.includes(field)) guarded[field] = change;
    else free[field] = change;
  }
  return { guarded, free };
}

export function countChanges(set: ChangeSet): number {
  return Object.keys(set).length;
}

/** Alasan wajib & cukup spesifik — ini yang dibaca Director saat memutuskan. */
export const MIN_REASON_LENGTH = 10;

export function validateReason(reason: string): string {
  const r = reason.trim();
  if (r === "") throw new Error("Alasan perubahan wajib diisi");
  if (r.length < MIN_REASON_LENGTH) {
    throw new Error(`Alasan perubahan terlalu singkat (minimal ${MIN_REASON_LENGTH} karakter)`);
  }
  return r;
}

/** Ringkasan satu baris per field untuk panel approval Director & audit log. */
export function summarizeChanges(set: ChangeSet): string[] {
  return (Object.entries(set) as [EditableField, FieldChange][]).map(
    ([field, c]) => `${FIELD_LABELS[field]}: ${c.before ?? "—"} → ${c.after ?? "—"}`,
  );
}

/** { field: {before, after} } → { field: <sisi yang diminta> }, untuk audit log host. */
export function mapSide(set: ChangeSet, side: "before" | "after"): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const [field, change] of Object.entries(set)) {
    if (change) out[field] = change[side];
  }
  return out;
}

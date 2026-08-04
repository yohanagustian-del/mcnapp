import { parseRupiah } from "@/lib/utils/rupiah";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TERMS,
  TXN_DIRECTIONS,
  type FinanceTransaction,
} from "./transaction";

/**
 * Modul Finance — logika pengajuan perubahan transaksi (pure, deterministik, 0 LLM).
 *
 * Aturan (CLAUDE.md #9): transaksi finance BOLEH berubah — klien memang bisa ganti
 * metode/rekening pembayaran — tapi tidak lewat UPDATE langsung. Setiap perubahan
 * dipecah dua:
 *   - field TERKUNCI (uang, tujuan uang, identitas pihak) → change request +
 *     approval Director sebelum berlaku (aksi manusia berpotensi merugikan, CLAUDE.md #2)
 *   - field BEBAS (keterangan) → berlaku langsung + audit (tidak merugikan → auto)
 *
 * Daftar field terkunci datang dari app_config `finance.guarded_fields`, JANGAN
 * di-hardcode di sini — Director bisa menggesernya tanpa deploy. Modul ini hanya
 * menerima daftarnya sebagai argumen.
 */

/** Field yang boleh diajukan berubah. Cermin whitelist di apply_finance_change(). */
export const EDITABLE_FIELDS = [
  "direction",
  "client_name",
  "deal_id",
  "creator_id",
  "project_id",
  "invoice_no",
  "amount",
  "payment_method",
  "payment_terms",
  "payment_status",
  "bank_name",
  "bank_account_no",
  "bank_account_name",
  "due_date",
  "paid_at",
  "notes",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABELS: Record<EditableField, string> = {
  direction: "Arah Transaksi",
  client_name: "Nama Klien / Brand",
  deal_id: "Deal Terkait",
  creator_id: "Kreator Terkait",
  project_id: "Special Project",
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

/** Nilai per field setelah normalisasi — hanya tipe yang bisa masuk jsonb. */
export type FieldValue = string | number | null;

export interface FieldChange {
  before: FieldValue;
  after: FieldValue;
}
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
/** Field yang wajib terisi — mengosongkannya bukan "perubahan", itu merusak baris. */
const REQUIRED_FIELDS: EditableField[] = [
  "direction",
  "client_name",
  "amount",
  "payment_method",
  "payment_terms",
  "payment_status",
];

/**
 * Bentuk input form (selalu string) menjadi nilai typed yang sebanding dengan
 * kolom DB. Melempar error dengan pesan Bahasa Indonesia untuk input tak valid —
 * pengajuan perubahan pembayaran tidak boleh "diam-diam null" seperti ingest
 * sheet lama (CLAUDE.md #7 berlaku untuk data warisan, bukan untuk form ini).
 */
export function normalizeFieldValue(field: EditableField, raw: unknown): FieldValue {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();

  if (s === "") {
    if (REQUIRED_FIELDS.includes(field)) {
      throw new Error(`${FIELD_LABELS[field]} wajib diisi`);
    }
    return null;
  }

  const allowed = ENUM_VALUES[field];
  if (allowed) {
    if (!allowed.includes(s)) throw new Error(`${FIELD_LABELS[field]} tidak valid: "${s}"`);
    return s;
  }

  if (NUMERIC_FIELDS.includes(field)) {
    // Nominal ditulis manusia: "Rp1,075,484,867" / "Rp4.131.512.642" (parseRupiah).
    const n = field === "amount" ? parseRupiah(s) : Number(s);
    if (n === null || !Number.isFinite(n)) {
      throw new Error(`${FIELD_LABELS[field]} bukan angka yang valid: "${s}"`);
    }
    if (n < 0) throw new Error(`${FIELD_LABELS[field]} tidak boleh negatif`);
    return field === "project_id" ? Math.trunc(n) : n;
  }

  if (DATE_FIELDS.includes(field)) {
    // Date picker mengirim YYYY-MM-DD; teks bebas ("19 February 2026") ditolak di
    // sini — form finance wajib tervalidasi, bukan free-text (CLAUDE.md #6).
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

/** Nilai transaksi saat ini dalam bentuk yang sebanding dengan hasil normalisasi. */
function currentValue(txn: FinanceTransaction, field: EditableField): FieldValue {
  const v = (txn as unknown as Record<string, unknown>)[field];
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  return String(v);
}

/**
 * Bandingkan usulan (sudah dinormalisasi) dengan transaksi sekarang → hanya field
 * yang benar-benar BERUBAH. Field yang dikirim form tapi nilainya sama tidak ikut,
 * supaya Director tidak diminta menyetujui perubahan kosong.
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
    // bukan perubahan.
    const same =
      typeof before === "number" || typeof after === "number"
        ? Number(before ?? NaN) === Number(after ?? NaN) ||
          (before === null && after === null)
        : before === after;
    if (!same) diff[field] = { before, after };
  }
  return diff;
}

export interface PartitionedChanges {
  /** Butuh approval Director sebelum berlaku. */
  guarded: ChangeSet;
  /** Berlaku langsung + audit (auto). */
  free: ChangeSet;
}

/** Pecah changeset memakai daftar field terkunci dari app_config. */
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

/** Ringkasan satu baris per field untuk panel approval Director & audit_logs. */
export function summarizeChanges(set: ChangeSet): string[] {
  return (Object.entries(set) as [EditableField, FieldChange][]).map(
    ([field, c]) => `${FIELD_LABELS[field]}: ${c.before ?? "—"} → ${c.after ?? "—"}`,
  );
}

/**
 * Modul Finance — bentuk transaksi + nomor transaksi (pure, tanpa I/O).
 *
 * Nomor transaksi TRX-YYYYMM-NNNN dipakai manusia di invoice dan rekonsiliasi
 * bank, jadi harus berurutan per bulan dan menunjukkan periode — berbeda dari
 * genId() (CRT-/DEAL-/LNK-) yang acak. Nomor urutnya diambil di DB
 * (next_finance_trx_id) supaya dua request bersamaan tidak dapat nomor sama;
 * modul ini hanya memformat dan memvalidasi.
 */

export const PAYMENT_METHODS = [
  "transfer_bank",
  "virtual_account",
  "ewallet",
  "qris",
  "kartu_kredit",
  "tunai",
  "potong_komisi",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Label UI Bahasa Indonesia (kode/komentar Bahasa Inggris — CLAUDE.md konvensi). */
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
  masuk: "Uang Masuk (klien → MEA)",
  keluar: "Uang Keluar (MEA → kreator/vendor)",
};

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

/** Periode nomor transaksi dari tanggal: 2026-08-04 → "202608". */
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
  if (!m) return null;
  return { period: m[1], seq: Number(m[2]) };
}

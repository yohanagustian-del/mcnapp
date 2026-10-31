/**
 * Request Ads — mesin status & aturan murni (0 LLM, tanpa import server).
 * Plan: docs/plans/ADS_TRACKING_FINANCE_2026-10.md §2.4; keputusan D-2026-10-31-1…6.
 *
 * Satu entitas = baris `ads_briefs` (diperluas migrasi 0100). Pemilik = slot Jadwal
 * Live ATAU Special Project. Realisasi belanja tetap `ads_campaign_results.ads_spent`
 * (sumber tunggal ads spend M7 — CLAUDE.md #4).
 */
import {
  fundingNeedsCashCheck,
  fundingNeedsPaymentMethod,
  type FundingType,
  type PaymentMethod,
} from "./funding-spec";

// ---------- Status ----------

/** Status request baru (0100). Nilai lama 0012 (`baru`, `menunggu_approval`) tetap sah untuk baris lama. */
export const REQUEST_STATUSES = [
  "diajukan",
  "menunggu_approval_director",
  "menunggu_finance",
  "siap_dieksekusi",
  "dikerjakan",
  "selesai",
  "ditolak",
  "batal",
  // legacy (0012)
  "baru",
  "menunggu_approval",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  diajukan: "Diajukan",
  menunggu_approval_director: "Menunggu approval Director",
  menunggu_finance: "Menunggu ACC",
  siap_dieksekusi: "Siap dieksekusi",
  dikerjakan: "Dikerjakan",
  selesai: "Selesai",
  ditolak: "Ditolak",
  batal: "Batal",
  baru: "Baru (lama)",
  menunggu_approval: "Menunggu approval Director (lama)",
};

/** Status yang masih "hidup" (ikut menghabiskan jatah MEA, tampil di antrean). */
export const OPEN_STATUSES: RequestStatus[] = [
  "diajukan", "menunggu_approval_director", "menunggu_finance", "siap_dieksekusi", "dikerjakan", "baru", "menunggu_approval",
];
/** Status akhir (tidak bisa diubah lagi). */
export const TERMINAL_STATUSES: RequestStatus[] = ["selesai", "ditolak", "batal"];

export type RequestAction =
  | "director_approve"
  | "director_reject"
  | "finance_acc"
  | "finance_reject"
  | "claim"
  | "finish"
  | "cancel";

/**
 * Tabel transisi (§2.4). Kunci = status asal; nilai = aksi → status tujuan.
 * `diajukan` hanya status sesaat saat insert (langsung dipetakan oleh initialRequestStatus),
 * tetap ada supaya baris lama/manual bisa dilanjutkan.
 */
export const TRANSITIONS: Record<RequestStatus, Partial<Record<RequestAction, RequestStatus>>> = {
  diajukan: { cancel: "batal", finance_acc: "siap_dieksekusi", finance_reject: "ditolak" },
  menunggu_approval_director: { director_approve: "menunggu_finance", director_reject: "ditolak", cancel: "batal" },
  menunggu_finance: { finance_acc: "siap_dieksekusi", finance_reject: "ditolak", cancel: "batal" },
  siap_dieksekusi: { claim: "dikerjakan", cancel: "batal" },
  dikerjakan: { finish: "selesai" },
  selesai: {},
  ditolak: {},
  batal: {},
  // legacy 0012: brief lama tanpa pendanaan bisa diklaim/diselesaikan seperti dulu.
  baru: { claim: "dikerjakan", cancel: "batal", finance_acc: "siap_dieksekusi" },
  menunggu_approval: { director_approve: "menunggu_finance", director_reject: "ditolak", cancel: "batal" },
};

export const TRANSITION_MESSAGES: Record<RequestAction, string> = {
  director_approve: "[request tidak sedang menunggu approval Director]",
  director_reject: "[request tidak sedang menunggu approval Director]",
  finance_acc: "[request tidak sedang menunggu ACC — status sekarang tidak bisa di-ACC]",
  finance_reject: "[request tidak sedang menunggu ACC — tidak bisa ditolak]",
  claim: "[request ads masih menunggu ACC — belum bisa dieksekusi]",
  finish: "[request belum dikerjakan — belum bisa diselesaikan]",
  cancel: "[request sudah dieksekusi/selesai — tidak bisa dibatalkan]",
};

export type TransitionResult =
  | { ok: true; to: RequestStatus }
  | { ok: false; error: string };

/** Transisi aman: tujuan dari tabel, pesan Bahasa Indonesia dalam kurung siku bila tidak sah. */
export function transition(from: RequestStatus, action: RequestAction): TransitionResult {
  const to = TRANSITIONS[from]?.[action];
  if (!to) return { ok: false, error: TRANSITION_MESSAGES[action] };
  return { ok: true, to };
}

// ---------- Jatah budget MEA (D-2026-10-31-4) ----------

export interface MeaBudgetCheck {
  budget: number;
  used: number;
  remaining: number;
  /** request ini membuat terpakai > jatah → approval Director */
  needsDirectorApproval: boolean;
}

/**
 * Jatah bulan = baris `creator_ads_monthly_budgets` (tanpa baris = 0). Terpakai = Σ nominal
 * request `mea_budget` bulan itu yang masih hidup/selesai (dihitung pemanggil dari view).
 * Sisa bulan lalu hangus — hanya bulan ini yang dilihat.
 */
export function checkMeaBudget(budget: number | null, used: number, requested: number | null): MeaBudgetCheck {
  const b = Math.max(0, budget ?? 0);
  const u = Math.max(0, used);
  const r = Math.max(0, requested ?? 0);
  return {
    budget: b,
    used: u,
    remaining: Math.max(0, b - u),
    needsDirectorApproval: u + r > b,
  };
}

export function meaBudgetMessage(check: MeaBudgetCheck): string {
  return `[jatah budget MEA bulan ini tersisa Rp${Math.round(check.remaining).toLocaleString("id-ID")}, request melebihi — butuh approval Director]`;
}

/** Bulan jatah (YYYY-MM-01) dari tanggal live/project. */
export function budgetMonthOf(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

// ---------- Status awal saat insert ----------

export function initialRequestStatus(input: {
  fundingType: FundingType;
  meaCheck: MeaBudgetCheck | null;
}): RequestStatus {
  if (input.fundingType === "mea_budget" && input.meaCheck?.needsDirectorApproval) {
    return "menunggu_approval_director";
  }
  return "menunggu_finance";
}

// ---------- Validasi isian ----------

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateRequestInput(input: {
  fundingType: FundingType | null;
  paymentMethod: PaymentMethod | null;
  budgetRequested: number | null;
  ownerSlotId: number | null;
  ownerProjectId: number | null;
}): ValidationResult {
  if (!input.fundingType) return { ok: false, error: "[tipe pendanaan ads wajib dipilih]" };
  if (fundingNeedsPaymentMethod(input.fundingType) && !input.paymentMethod) {
    return { ok: false, error: "[metode pembayaran (cash di awal / invoice) wajib dipilih untuk creator/brand budget]" };
  }
  if (!fundingNeedsPaymentMethod(input.fundingType) && input.paymentMethod) {
    return { ok: false, error: "[metode pembayaran hanya untuk creator/brand budget]" };
  }
  if (input.budgetRequested == null || !(input.budgetRequested > 0)) {
    return { ok: false, error: "[nominal budget ads wajib diisi dan lebih dari 0]" };
  }
  const owners = [input.ownerSlotId, input.ownerProjectId].filter((v) => v != null).length;
  if (owners !== 1) {
    return { ok: false, error: "[request ads harus terkait tepat satu: slot Jadwal Live ATAU Special Project]" };
  }
  return { ok: true };
}

// ---------- Gate Finance / Head (D-2026-10-31-3) ----------

/** Role yang boleh ACC request ini. Cash = Finance (+Director override); lainnya = Head CM atau Finance. */
export function accRolesFor(ft: FundingType, pm: PaymentMethod | null): readonly string[] {
  if (fundingNeedsCashCheck(ft, pm)) return ["finance", "director"];
  return ["finance", "head", "cm_lead", "director"];
}

export function canAccRequest(role: string, ft: FundingType, pm: PaymentMethod | null): boolean {
  return accRolesFor(ft, pm).includes(role);
}

/** Gate sebelum ACC: cash di awal wajib punya tanggal uang masuk. */
export function financeGate(input: {
  fundingType: FundingType;
  paymentMethod: PaymentMethod | null;
  cashReceivedAt: string | null;
}): ValidationResult {
  if (fundingNeedsCashCheck(input.fundingType, input.paymentMethod) && !input.cashReceivedAt) {
    return { ok: false, error: "[pembayaran cash belum tercatat, isi tanggal uang masuk sebelum ACC]" };
  }
  return { ok: true };
}

// ---------- Invoice (D-2026-10-31-6) ----------

export interface InvoiceAmounts {
  dpp: number;
  ppn: number;
  total: number;
  ppnRate: number;
}

/** DPP = nominal request; PPN = DPP × tarif (dibulatkan ke rupiah); total = DPP + PPN. */
export function invoiceAmounts(dpp: number, ppnRate: number): InvoiceAmounts {
  const base = Math.max(0, Math.round(dpp));
  const rate = Math.max(0, ppnRate);
  const ppn = Math.round(base * rate);
  return { dpp: base, ppn, total: base + ppn, ppnRate: rate };
}

function addDaysIso(dateIso: string, days: number): string {
  const t = Date.parse(`${dateIso}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export function invoiceDueDate(issuedAtIso: string, dueDays: number): string {
  return addDaysIso(issuedAtIso, Math.max(0, Math.round(dueDays)));
}

export type InvoiceReminderState = "aman" | "segera" | "jatuh_tempo";

/**
 * Flag jatuh tempo DIHITUNG, tidak disimpan (pola CDPS M5). `segera` = due_date − today ≤ reminderDays.
 */
export function invoiceReminderState(
  dueDateIso: string,
  todayIso: string,
  reminderDays: number,
  paid: boolean
): InvoiceReminderState {
  if (paid) return "aman";
  const diffDays = Math.round((Date.parse(`${dueDateIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000);
  if (diffDays < 0) return "jatuh_tempo";
  if (diffDays <= reminderDays) return "segera";
  return "aman";
}

/** Nomor invoice `INV-YYYYMM-NNNN`; `lastSeq` = urutan terakhir bulan itu (0 bila belum ada). */
export function nextInvoiceNumber(yyyymm: string, lastSeq: number): string {
  if (!/^\d{6}$/.test(yyyymm)) throw new Error("[periode invoice tidak valid]");
  const seq = Math.max(0, Math.floor(lastSeq)) + 1;
  return `INV-${yyyymm}-${String(seq).padStart(4, "0")}`;
}

/** Ambil urutan dari nomor invoice yang ada (`INV-202610-0007` → 7); null bila bukan format ini. */
export function invoiceSeqOf(id: string): number | null {
  const m = /^INV-(\d{6})-(\d{4,})$/.exec(id);
  return m ? Number(m[2]) : null;
}

export const INVOICE_STATUSES = ["terbit", "lunas", "batal"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  terbit: "Terbit", lunas: "Lunas", batal: "Batal",
};

export const INVOICE_EVENTS = ["dibuat", "dikirim", "diingatkan", "dibayar", "dibatalkan"] as const;
export type InvoiceEvent = (typeof INVOICE_EVENTS)[number];

/** Pencatatan pembayaran: nominal ≤ total; nominal kurang = tetap lunas? Tidak — harus penuh. */
export function validatePayment(total: number, paidAmount: number | null): ValidationResult {
  if (paidAmount == null || !(paidAmount > 0)) return { ok: false, error: "[nominal pembayaran wajib diisi]" };
  if (paidAmount > total) return { ok: false, error: "[nominal pembayaran melebihi total invoice, periksa kembali]" };
  if (paidAmount < total) return { ok: false, error: "[nominal pembayaran kurang dari total invoice — invoice hanya bisa ditandai lunas bila dibayar penuh]" };
  return { ok: true };
}

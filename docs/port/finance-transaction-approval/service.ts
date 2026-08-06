import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  countChanges,
  diffTransaction,
  mapSide,
  normalizeFieldValue,
  partitionChanges,
  summarizeChanges,
  trxPeriod,
  validateReason,
  type ChangeSet,
  type EditableField,
  type FieldValue,
  type FinanceTransaction,
} from "./change-request";

/**
 * PORTABLE — orkestrasi mekanisme approval transaksi finance.
 *
 * Ini bagian yang di README dulu ditulis "harus dibuat sendiri di app tujuan".
 * Ternyata justru di sini subtleti yang paling mudah salah, dan salahnya tidak
 * kelihatan sampai ada uang nyangkut di rekening yang salah. Contoh urutan yang
 * penting dan tidak jelas kalau ditulis dari nol:
 *
 *   - cek pengajuan `menunggu` HARUS sebelum menghitung diff, supaya user dapat
 *     pesan jelas alih-alih unique-violation mentah dari DB
 *   - field bebas diterapkan LANGSUNG, field terkunci TIDAK — dan orkestrator ini
 *     tidak boleh pernah menyentuh field terkunci sendiri, sekalipun "cuma untuk
 *     satu kasus"; itu tugas apply_finance_change() setelah Director approve
 *   - alasan wajib HANYA kalau ada yang perlu diputuskan Director (kalau tidak ada
 *     yang memutuskan, alasan itu tidak punya pembaca)
 *   - alasan PENOLAKAN wajib; approve boleh tanpa catatan
 *
 * Nol dependensi selain ./change-request. Tidak mengasumsikan framework, ORM, atau
 * model role tertentu: host menyuntikkan `FinanceStore` (7 fungsi kecil),
 * `writeAudit`, dan `Actor` berisi empat boolean kapabilitas. Peta role → boolean
 * itu milik host — di situlah satu-satunya tempat model role host muncul.
 */

// ============================================================
// Yang harus disediakan host
// ============================================================

export interface NewTransactionInput {
  /** Nilai mentah dari form; hanya key di EDITABLE_FIELDS yang dibaca. */
  fields: Record<string, unknown>;
}

export interface PendingChangeRow {
  id: number;
  transaction_id: string;
  changes: ChangeSet;
  reason: string;
  status: "menunggu" | "approved" | "ditolak" | "dibatalkan";
  requested_by: string | null;
}

export interface FinanceStore {
  /** SELECT satu transaksi; null kalau tidak ada. */
  getTransaction(id: string): Promise<FinanceTransaction | null>;

  /** RPC next_finance_trx_id(period) — JANGAN dihitung di app (lihat catatan §nomor). */
  nextTransactionId(period: string): Promise<string>;

  /** INSERT transaksi baru, return id-nya. */
  insertTransaction(row: Record<string, FieldValue> & { id: string; created_by: string }): Promise<string>;

  /**
   * UPDATE field BEBAS saja. Implementasi host tidak perlu menyaring apa pun:
   * trigger DB akan menolak kalau ada field terkunci ikut terbawa — dan itu memang
   * jaring pengaman yang diinginkan, bukan sesuatu untuk dihindari.
   */
  updateTransactionFields(id: string, patch: Record<string, FieldValue>): Promise<void>;

  /** Pengajuan berstatus `menunggu` untuk transaksi ini, kalau ada. */
  findPendingChange(transactionId: string): Promise<{ id: number } | null>;

  /** INSERT pengajuan berstatus `menunggu`, return id-nya. */
  insertChange(input: {
    transactionId: string;
    changes: ChangeSet;
    reason: string;
    requestedBy: string;
  }): Promise<number>;

  getChange(id: number): Promise<PendingChangeRow | null>;

  /** RPC apply_finance_change(request_id, actor, note) — atomic, satu-satunya jalur sah. */
  applyChange(requestId: number, actorId: string, note: string | null): Promise<void>;

  /** UPDATE status pengajuan untuk `ditolak` / `dibatalkan` (tidak menyentuh transaksi). */
  closeChange(
    id: number,
    patch: { status: "ditolak" | "dibatalkan"; decidedBy: string; decisionNote: string | null },
  ): Promise<void>;

  /** app_config finance.guarded_fields — dibaca RUNTIME, tidak boleh dihardcode host. */
  readGuardedFields(): Promise<string[]>;
}

export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  type: "auto" | "approval";
}
export type WriteAudit = (entry: AuditEntry) => Promise<void>;

/**
 * Kapabilitas aktor, BUKAN role. Host memetakan role-nya sendiri ke empat boolean
 * ini — itu satu-satunya titik yang perlu disesuaikan saat porting.
 *
 * Peta di MCN MEA (lihat README §1):
 *   canCreate   : staff finance, lead finance, management
 *   canRequest  : lead finance, management        ← BUKAN staff finance
 *   canApprove  : director SAJA                   ← head/spv pun tidak
 *   isManagement: director/head/spv               (boleh membatalkan pengajuan orang lain)
 */
export interface Actor {
  id: string;
  canCreate: boolean;
  canRequest: boolean;
  canApprove: boolean;
  isManagement: boolean;
}

export interface Deps {
  store: FinanceStore;
  writeAudit: WriteAudit;
  /** Disuntikkan supaya bisa diuji; default waktu sekarang. */
  now?: () => Date;
}

// ============================================================
// Helper
// ============================================================

/** Baca HANYA field yang benar-benar dikirim form, lalu normalisasi + validasi. */
function readProposed(fields: Record<string, unknown>): Partial<Record<EditableField, FieldValue>> {
  const proposed: Partial<Record<EditableField, FieldValue>> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in fields)) continue;
    proposed[field] = normalizeFieldValue(field, fields[field]);
  }
  return proposed;
}

function afterValues(set: ChangeSet): Record<string, FieldValue> {
  return mapSide(set, "after");
}

// ============================================================
// 1. Catat transaksi baru
// ============================================================
// Menambah data & tidak merugikan → berlaku langsung, tapi TETAP diaudit (`auto`).

export async function createFinanceTransaction(
  deps: Deps,
  actor: Actor,
  input: NewTransactionInput,
): Promise<string> {
  if (!actor.canCreate) throw new Error("Akses ditolak: tidak punya izin mencatat transaksi finance");

  const proposed = readProposed(input.fields);
  for (const required of ["client_name", "amount", "payment_method"] as const) {
    if (proposed[required] === undefined || proposed[required] === null) {
      throw new Error(`${FIELD_LABELS[required]} wajib diisi`);
    }
  }

  // Periode dari jatuh tempo bila ada, kalau tidak dari waktu sekarang.
  const now = deps.now?.() ?? new Date();
  const period = trxPeriod((proposed.due_date as string | undefined) ?? now);
  const id = await deps.store.nextTransactionId(period);

  await deps.store.insertTransaction({
    ...(proposed as Record<string, FieldValue>),
    direction: proposed.direction ?? "masuk",
    payment_terms: proposed.payment_terms ?? "invoice",
    payment_status: proposed.payment_status ?? "pending",
    id,
    created_by: actor.id,
  });

  await deps.writeAudit({
    actorId: actor.id,
    action: "finance.transaction_create",
    entityType: "finance_transactions",
    entityId: id,
    after: proposed,
    type: "auto",
  });

  return id;
}

// ============================================================
// 2. Ajukan perubahan
// ============================================================

export interface RequestOutcome {
  /** Field bebas yang sudah berlaku sekarang. */
  appliedNow: EditableField[];
  /** Field terkunci yang menunggu keputusan Director (belum berlaku). */
  awaitingApproval: EditableField[];
  /** id pengajuan, null kalau semua perubahan ternyata field bebas. */
  changeRequestId: number | null;
}

export async function requestFinanceChange(
  deps: Deps,
  actor: Actor,
  input: { transactionId: string; fields: Record<string, unknown>; reason: string },
): Promise<RequestOutcome> {
  if (!actor.canRequest) {
    throw new Error(
      "Akses ditolak: perubahan transaksi hanya bisa diajukan Senior/Lead Finance atau management",
    );
  }

  const txn = await deps.store.getTransaction(input.transactionId);
  if (!txn) throw new Error(`Transaksi ${input.transactionId} tidak ditemukan`);

  // SEBELUM menghitung diff: kalau sudah ada pengajuan menunggu, user harus dapat
  // pesan yang bisa ditindaklanjuti — bukan unique-violation dari DB.
  const pending = await deps.store.findPendingChange(input.transactionId);
  if (pending) {
    throw new Error(
      "Masih ada pengajuan perubahan yang menunggu approval Director. Batalkan dulu sebelum mengajukan yang baru.",
    );
  }

  const diff = diffTransaction(txn, readProposed(input.fields));
  if (countChanges(diff) === 0) throw new Error("Tidak ada field yang berubah");

  const { guarded, free } = partitionChanges(diff, await deps.store.readGuardedFields());

  // Alasan wajib hanya kalau ada yang perlu Director putuskan. Kalau perubahannya
  // cuma keterangan, tidak ada yang akan membacanya.
  const reason = countChanges(guarded) > 0 ? validateReason(input.reason) : input.reason.trim();

  const outcome: RequestOutcome = {
    appliedNow: Object.keys(free) as EditableField[],
    awaitingApproval: Object.keys(guarded) as EditableField[],
    changeRequestId: null,
  };

  if (countChanges(free) > 0) {
    await deps.store.updateTransactionFields(txn.id, afterValues(free));
    await deps.writeAudit({
      actorId: actor.id,
      action: "finance.transaction_edit_free",
      entityType: "finance_transactions",
      entityId: txn.id,
      before: mapSide(free, "before"),
      after: afterValues(free),
      type: "auto",
    });
  }

  if (countChanges(guarded) > 0) {
    // Sengaja TIDAK menyentuh finance_transactions di sini. Ini inti aturannya.
    outcome.changeRequestId = await deps.store.insertChange({
      transactionId: txn.id,
      changes: guarded,
      reason,
      requestedBy: actor.id,
    });
    await deps.writeAudit({
      actorId: actor.id,
      action: "finance.change_requested",
      entityType: "finance_transaction_changes",
      entityId: String(outcome.changeRequestId),
      before: mapSide(guarded, "before"),
      after: { transaction_id: txn.id, reason, changes: summarizeChanges(guarded) },
      type: "approval",
    });
  }

  return outcome;
}

// ============================================================
// 3. Putuskan (Director)
// ============================================================

export async function decideFinanceChange(
  deps: Deps,
  actor: Actor,
  input: { requestId: number; approve: boolean; note?: string | null },
): Promise<void> {
  if (!actor.canApprove) {
    throw new Error("Akses ditolak: hanya Director yang bisa menyetujui perubahan transaksi finance");
  }

  const req = await deps.store.getChange(input.requestId);
  if (!req) throw new Error("Pengajuan perubahan tidak ditemukan");
  if (req.status !== "menunggu") {
    throw new Error(`Pengajuan ini sudah diputuskan (status: ${req.status})`);
  }
  // Pengaju ≠ pemutus. Di MCN MEA role-nya sudah terpisah (finance_lead tidak punya
  // canApprove), tapi seorang management yang punya keduanya tetap tidak boleh
  // menyetujui pengajuannya sendiri — itu menghapus arti gate-nya.
  if (req.requested_by === actor.id) {
    throw new Error("Pengaju tidak boleh menyetujui atau menolak pengajuannya sendiri");
  }

  const note = (input.note ?? "").trim() || null;

  if (input.approve) {
    // Atomic di DB: patch transaksi + tandai approved. Satu-satunya jalur yang
    // boleh menyentuh field terkunci.
    await deps.store.applyChange(input.requestId, actor.id, note);
  } else {
    if (!note) throw new Error("Alasan penolakan wajib diisi");
    await deps.store.closeChange(input.requestId, {
      status: "ditolak",
      decidedBy: actor.id,
      decisionNote: note,
    });
  }

  await deps.writeAudit({
    actorId: actor.id,
    action: input.approve ? "finance.change_approved" : "finance.change_rejected",
    entityType: "finance_transaction_changes",
    entityId: String(input.requestId),
    before: mapSide(req.changes, "before"),
    after: {
      transaction_id: req.transaction_id,
      decision: input.approve ? "approved" : "ditolak",
      by: actor.id,
      note,
      changes: summarizeChanges(req.changes),
    },
    type: "approval",
  });
}

// ============================================================
// 4. Batalkan (pengaju atau management)
// ============================================================

export async function cancelFinanceChange(
  deps: Deps,
  actor: Actor,
  input: { requestId: number; note?: string | null },
): Promise<void> {
  if (!actor.canRequest) throw new Error("Akses ditolak: tidak punya izin atas pengajuan perubahan");

  const req = await deps.store.getChange(input.requestId);
  if (!req) throw new Error("Pengajuan perubahan tidak ditemukan");
  if (req.status !== "menunggu") throw new Error("Pengajuan ini sudah diputuskan");
  if (req.requested_by !== actor.id && !actor.isManagement) {
    throw new Error("Hanya pengaju atau management yang bisa membatalkan pengajuan ini");
  }

  await deps.store.closeChange(input.requestId, {
    status: "dibatalkan",
    decidedBy: actor.id,
    decisionNote: (input.note ?? "").trim() || null,
  });

  await deps.writeAudit({
    actorId: actor.id,
    action: "finance.change_cancelled",
    entityType: "finance_transaction_changes",
    entityId: String(input.requestId),
    after: { transaction_id: req.transaction_id },
    type: "approval",
  });
}

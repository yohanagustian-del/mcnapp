"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission, MANAGEMENT_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { trxPeriod, type FinanceTransaction } from "@/lib/finance/transaction";
import {
  EDITABLE_FIELDS,
  diffTransaction,
  normalizeFieldValue,
  partitionChanges,
  summarizeChanges,
  validateReason,
  countChanges,
  type ChangeSet,
  type EditableField,
  type FieldValue,
} from "@/lib/finance/change-request";

/**
 * M14 Finance server actions.
 *
 * Mekanisme ubah transaksi (CLAUDE.md #9):
 *   Senior/Lead Finance mengajukan → field terkunci menunggu approval Director →
 *   Director approve → apply_finance_change() menerapkannya dalam SATU transaksi DB.
 * Tidak ada action yang meng-UPDATE field terkunci langsung; trigger
 * guard_finance_txn_update() menolaknya walaupun dipanggil dengan service-role.
 */

const TXN_COLUMNS =
  "id, direction, client_name, deal_id, creator_id, project_id, invoice_no, amount, " +
  "payment_method, payment_terms, payment_status, bank_name, bank_account_no, " +
  "bank_account_name, due_date, paid_at, notes, created_by, created_at, updated_at";

/** Daftar field terkunci selalu dari app_config — jangan hardcode (CLAUDE.md konvensi). */
async function guardedFields(): Promise<string[]> {
  return await getConfig<string[]>("finance.guarded_fields");
}

/** Baca field yang dikirim form (hanya yang ADA di FormData) lalu normalisasi. */
function readProposed(formData: FormData): Partial<Record<EditableField, FieldValue>> {
  const proposed: Partial<Record<EditableField, FieldValue>> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!formData.has(field)) continue;
    proposed[field] = normalizeFieldValue(field, formData.get(field));
  }
  return proposed;
}

/** §1 — catat transaksi baru. Menambah data → auto (CLAUDE.md #2), tetap diaudit. */
export async function createTransaction(formData: FormData): Promise<void> {
  const actor = await requirePermission("finance.transaction_create");
  const admin = createAdminClient();

  const proposed = readProposed(formData);
  for (const required of ["client_name", "amount", "payment_method"] as const) {
    if (proposed[required] === undefined || proposed[required] === null) {
      throw new Error("Nama klien, nominal, dan metode pembayaran wajib diisi");
    }
  }

  // Nomor urut per bulan diambil di DB (advisory lock) supaya dua input bersamaan
  // tidak dapat nomor sama. Periode dari tanggal jatuh tempo bila ada, kalau tidak hari ini.
  const period = trxPeriod((proposed.due_date as string) ?? new Date());
  const { data: nextId, error: idError } = await admin.rpc("next_finance_trx_id", { p_month: period });
  if (idError) throw new Error(`Gagal membuat nomor transaksi: ${idError.message}`);

  const { data: row, error } = await admin
    .from("finance_transactions")
    .insert({
      id: nextId as string,
      direction: proposed.direction ?? "masuk",
      client_name: proposed.client_name,
      deal_id: proposed.deal_id ?? null,
      creator_id: proposed.creator_id ?? null,
      project_id: proposed.project_id ?? null,
      invoice_no: proposed.invoice_no ?? null,
      amount: proposed.amount,
      payment_method: proposed.payment_method,
      payment_terms: proposed.payment_terms ?? "invoice",
      payment_status: proposed.payment_status ?? "pending",
      bank_name: proposed.bank_name ?? null,
      bank_account_no: proposed.bank_account_no ?? null,
      bank_account_name: proposed.bank_account_name ?? null,
      due_date: proposed.due_date ?? null,
      paid_at: proposed.paid_at ?? null,
      notes: proposed.notes ?? null,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: actor.id,
    action: "finance.transaction_create",
    entityType: "finance_transactions",
    entityId: row.id,
    after: proposed,
    type: "auto",
  });
  revalidatePath("/finance/transactions");
}

/**
 * §2 — Senior/Lead Finance mengajukan perubahan transaksi.
 *
 * Field BEBAS (keterangan) langsung berlaku + audit `auto`; field TERKUNCI masuk
 * finance_transaction_changes berstatus `menunggu` + audit `approval`, dan BELUM
 * mengubah transaksi apa pun sampai Director memutuskan.
 */
export async function requestTransactionChange(formData: FormData): Promise<void> {
  const actor = await requirePermission("finance.request_change");
  const admin = createAdminClient();

  const transactionId = String(formData.get("transaction_id") ?? "").trim();
  if (!transactionId) throw new Error("Nomor transaksi tidak dikirim");

  const { data: txn } = await admin
    .from("finance_transactions")
    .select(TXN_COLUMNS)
    .eq("id", transactionId)
    .maybeSingle<FinanceTransaction>();
  if (!txn) throw new Error(`Transaksi ${transactionId} tidak ditemukan`);

  const { data: pending } = await admin
    .from("finance_transaction_changes")
    .select("id")
    .eq("transaction_id", transactionId)
    .eq("status", "menunggu")
    .maybeSingle();
  if (pending) {
    throw new Error(
      "Masih ada pengajuan perubahan yang menunggu approval Director. Batalkan dulu sebelum mengajukan yang baru.",
    );
  }

  const diff = diffTransaction(txn, readProposed(formData));
  if (countChanges(diff) === 0) throw new Error("Tidak ada field yang berubah");

  const { guarded, free } = partitionChanges(diff, await guardedFields());
  // Alasan wajib HANYA kalau ada yang perlu Director putuskan — kalau perubahannya
  // cuma keterangan, alasan itu tidak punya pembaca. Memaksanya justru melatih orang
  // menulis alasan basa-basi, yang lalu menular ke pengajuan yang beneran penting.
  const rawReason = String(formData.get("reason") ?? "");
  const reason = countChanges(guarded) > 0 ? validateReason(rawReason) : rawReason.trim();

  // Field bebas berlaku sekarang. Trigger DB tidak menghalangi karena field ini
  // tidak ada di finance.guarded_fields.
  if (countChanges(free) > 0) {
    const patch: Record<string, FieldValue> = {};
    for (const [field, change] of Object.entries(free) as [EditableField, { after: FieldValue }][]) {
      patch[field] = change.after;
    }
    const { error } = await admin
      .from("finance_transactions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", transactionId);
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: actor.id,
      action: "finance.transaction_edit_free",
      entityType: "finance_transactions",
      entityId: transactionId,
      before: mapSide(free, "before"),
      after: mapSide(free, "after"),
      type: "auto",
    });
  }

  if (countChanges(guarded) > 0) {
    const { data: req, error } = await admin
      .from("finance_transaction_changes")
      .insert({
        transaction_id: transactionId,
        changes: guarded,
        reason,
        status: "menunggu",
        requested_by: actor.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: actor.id,
      action: "finance.change_requested",
      entityType: "finance_transaction_changes",
      entityId: String(req.id),
      before: mapSide(guarded, "before"),
      after: { transaction_id: transactionId, reason, changes: summarizeChanges(guarded) },
      type: "approval",
    });
  }

  revalidatePath(`/finance/transactions/${transactionId}`);
  revalidatePath("/finance/transactions");
}

/** §3 — Director approve/tolak pengajuan. Approve = terapkan lewat RPC (atomic). */
export async function decideTransactionChange(formData: FormData): Promise<void> {
  const actor = await requirePermission("finance.approve_change");
  const admin = createAdminClient();

  const requestId = Number(formData.get("request_id"));
  if (!Number.isInteger(requestId)) throw new Error("Pengajuan perubahan tidak valid");
  const approve = String(formData.get("decision")) === "approve";
  const note = String(formData.get("decision_note") ?? "").trim() || null;

  const { data: req } = await admin
    .from("finance_transaction_changes")
    .select("id, transaction_id, changes, status, reason, requested_by")
    .eq("id", requestId)
    .maybeSingle<{
      id: number;
      transaction_id: string;
      changes: ChangeSet;
      status: string;
      reason: string;
      requested_by: string | null;
    }>();
  if (!req) throw new Error("Pengajuan perubahan tidak ditemukan");
  if (req.status !== "menunggu") {
    throw new Error(`Pengajuan ini sudah diputuskan (status: ${req.status})`);
  }
  // Pengaju ≠ pemutus. `finance.request_change` mencakup management (termasuk Director),
  // jadi tanpa cek ini seorang Director bisa mengajukan lalu menyetujui pengajuannya
  // sendiri — gate approval-nya jadi tidak berarti apa-apa. Cek di sini, bukan di RBAC:
  // yang dilarang bukan role-nya, melainkan kombinasi aktor+pengajuan tertentu.
  if (req.requested_by === actor.id) {
    throw new Error("Pengaju tidak boleh menyetujui atau menolak pengajuannya sendiri");
  }

  if (approve) {
    // Satu transaksi DB: patch transaksi + tandai pengajuan approved. Ini satu-satunya
    // jalur yang boleh menyentuh field terkunci (guard_finance_txn_update).
    const { error } = await admin.rpc("apply_finance_change", {
      p_request_id: requestId,
      p_actor: actor.id,
      p_note: note,
    });
    if (error) throw new Error(`Gagal menerapkan perubahan: ${error.message}`);
  } else {
    if (!note) throw new Error("Alasan penolakan wajib diisi");
    const { error } = await admin
      .from("finance_transaction_changes")
      .update({
        status: "ditolak",
        decided_by: actor.id,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq("id", requestId)
      .eq("status", "menunggu");
    if (error) throw new Error(error.message);
  }

  await writeAudit({
    actorId: actor.id,
    action: approve ? "finance.change_approved" : "finance.change_rejected",
    entityType: "finance_transaction_changes",
    entityId: String(requestId),
    before: mapSide(req.changes, "before"),
    after: {
      transaction_id: req.transaction_id,
      decision: approve ? "approved" : "ditolak",
      by: `director:${actor.id}`,
      note,
      changes: summarizeChanges(req.changes),
    },
    type: "approval",
  });

  revalidatePath(`/finance/transactions/${req.transaction_id}`);
  revalidatePath("/finance/transactions");
}

/** §4 — pembatalan oleh pengaju (atau management) sebelum Director memutuskan. */
export async function cancelTransactionChange(formData: FormData): Promise<void> {
  const actor = await requirePermission("finance.request_change");
  const admin = createAdminClient();

  const requestId = Number(formData.get("request_id"));
  if (!Number.isInteger(requestId)) throw new Error("Pengajuan perubahan tidak valid");

  const { data: req } = await admin
    .from("finance_transaction_changes")
    .select("id, transaction_id, requested_by, status")
    .eq("id", requestId)
    .maybeSingle<{ id: number; transaction_id: string; requested_by: string | null; status: string }>();
  if (!req) throw new Error("Pengajuan perubahan tidak ditemukan");
  if (req.status !== "menunggu") throw new Error("Pengajuan ini sudah diputuskan");
  // requirePermission di atas menyisakan dua kemungkinan: management atau finance_lead.
  // Lead lain tidak boleh membatalkan pengajuan rekannya; management boleh (atasan).
  const isManagement = MANAGEMENT_ROLES.includes(actor.role);
  if (req.requested_by !== actor.id && !isManagement) {
    throw new Error("Hanya pengaju atau management yang bisa membatalkan pengajuan ini");
  }

  const { error } = await admin
    .from("finance_transaction_changes")
    .update({
      status: "dibatalkan",
      decided_by: actor.id,
      decided_at: new Date().toISOString(),
      decision_note: String(formData.get("decision_note") ?? "").trim() || null,
    })
    .eq("id", requestId)
    .eq("status", "menunggu");
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: actor.id,
    action: "finance.change_cancelled",
    entityType: "finance_transaction_changes",
    entityId: String(requestId),
    after: { transaction_id: req.transaction_id },
    type: "approval",
  });

  revalidatePath(`/finance/transactions/${req.transaction_id}`);
  revalidatePath("/finance/transactions");
}

/** { field: {before, after} } → { field: <sisi yang diminta> } untuk audit_logs. */
function mapSide(set: ChangeSet, side: "before" | "after"): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const [field, change] of Object.entries(set)) {
    if (change) out[field] = change[side];
  }
  return out;
}

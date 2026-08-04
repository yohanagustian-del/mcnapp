import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember, canAccessNav, hasPermission, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getConfig } from "@/lib/config";
import { rupiah } from "@/lib/utils/format";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TERMS_LABELS,
  TXN_DIRECTION_LABELS,
  type FinanceTransaction,
} from "@/lib/finance/transaction";
import { FIELD_LABELS, type ChangeSet, type EditableField } from "@/lib/finance/change-request";
import { ChangeRequestForm } from "./change-request-form";
import { decideTransactionChange, cancelTransactionChange } from "../actions";

const TXN_COLUMNS =
  "id, direction, client_name, deal_id, creator_id, project_id, invoice_no, amount, " +
  "payment_method, payment_terms, payment_status, bank_name, bank_account_no, " +
  "bank_account_name, due_date, paid_at, notes, created_by, created_at, updated_at";

interface ChangeRow {
  id: number;
  changes: ChangeSet;
  reason: string;
  status: "menunggu" | "approved" | "ditolak" | "dibatalkan";
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_at: string | null;
}

const STATUS_BADGE: Record<ChangeRow["status"], string> = {
  menunggu: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  ditolak: "bg-red-100 text-red-800",
  dibatalkan: "bg-slate-100 text-slate-600",
};
const STATUS_LABEL: Record<ChangeRow["status"], string> = {
  menunggu: "Menunggu approval Director",
  approved: "Disetujui & diterapkan",
  ditolak: "Ditolak Director",
  dibatalkan: "Dibatalkan pengaju",
};

/** Nilai mentah DB → tampilan (enum & nominal pakai label, sisanya apa adanya). */
function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field) {
    case "amount":
      return rupiah(Number(value));
    case "payment_method":
      return PAYMENT_METHOD_LABELS[value as keyof typeof PAYMENT_METHOD_LABELS] ?? String(value);
    case "payment_terms":
      return PAYMENT_TERMS_LABELS[value as keyof typeof PAYMENT_TERMS_LABELS] ?? String(value);
    case "payment_status":
      return PAYMENT_STATUS_LABELS[value as keyof typeof PAYMENT_STATUS_LABELS] ?? String(value);
    case "direction":
      return TXN_DIRECTION_LABELS[value as keyof typeof TXN_DIRECTION_LABELS] ?? String(value);
    default:
      return String(value);
  }
}

export default async function FinanceTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/finance/transactions")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const canRequest = hasPermission("finance.request_change", member.role);
  const canApprove = hasPermission("finance.approve_change", member.role);

  const { id } = await params;
  const supabase = await createClient();

  const { data: txn } = await supabase
    .from("finance_transactions")
    .select(TXN_COLUMNS)
    .eq("id", id)
    .maybeSingle<FinanceTransaction>();
  if (!txn) notFound();

  const [{ data: changeRows }, { data: auditRows }, guardedFields] = await Promise.all([
    supabase
      .from("finance_transaction_changes")
      .select(
        "id, changes, reason, status, requested_by, requested_at, decided_by, decided_at, decision_note, applied_at",
      )
      .eq("transaction_id", id)
      .order("requested_at", { ascending: false })
      .limit(100),
    supabase
      .from("audit_logs")
      .select("id, action, actor_id, type, created_at")
      .eq("entity_type", "finance_transactions")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    getConfig<string[]>("finance.guarded_fields"),
  ]);

  const changes = (changeRows ?? []) as ChangeRow[];
  const pending = changes.find((c) => c.status === "menunggu") ?? null;

  // Nama pengaju/pemutus — satu query untuk semua uuid yang muncul.
  const memberIds = [
    ...new Set(
      changes
        .flatMap((c) => [c.requested_by, c.decided_by])
        .concat(txn.created_by)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: people } = memberIds.length
    ? await supabase.from("team_members").select("id, name, role").in("id", memberIds)
    : { data: [] };
  const nameOf = (uuid: string | null) =>
    (people ?? []).find((p) => p.id === uuid)?.name ?? (uuid ? "—" : "—");

  const infos: [string, string][] = [
    ["Arah Transaksi", displayValue("direction", txn.direction)],
    ["Klien / Brand", txn.client_name],
    ["Nomor Invoice", txn.invoice_no ?? "—"],
    ["Nominal", rupiah(txn.amount)],
    ["Metode Pembayaran", displayValue("payment_method", txn.payment_method)],
    ["Termin", displayValue("payment_terms", txn.payment_terms)],
    ["Status Pembayaran", displayValue("payment_status", txn.payment_status)],
    ["Bank Tujuan", txn.bank_name ?? "—"],
    ["Nomor Rekening", txn.bank_account_no ?? "—"],
    ["Nama Pemilik Rekening", txn.bank_account_name ?? "—"],
    ["Jatuh Tempo", txn.due_date ?? "—"],
    ["Tanggal Dibayar", txn.paid_at ?? "—"],
    ["Deal Terkait", txn.deal_id ?? "—"],
    ["Kreator Terkait", txn.creator_id ?? "—"],
    ["Dicatat oleh", nameOf(txn.created_by)],
    ["Terakhir diubah", new Date(txn.updated_at).toLocaleString("id-ID")],
  ];

  return (
    <div>
      <Link href="/finance/transactions" className="text-sm text-slate-500 hover:underline">
        ← Kembali ke daftar transaksi
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{txn.client_name}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[pending ? "menunggu" : "approved"]}`}>
          {pending ? "Ada pengajuan menunggu Director" : PAYMENT_STATUS_LABELS[txn.payment_status]}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-slate-500">{txn.id}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-4">
        {infos.map(([k, v]) => (
          <div key={k}>
            <p className="text-xs uppercase text-slate-400">{k}</p>
            <p className="mt-0.5 font-medium">{v}</p>
          </div>
        ))}
      </div>
      {txn.notes && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <span className="text-xs uppercase text-slate-400">Keterangan</span>
          <br />
          {txn.notes}
        </p>
      )}

      {/* ===== Pengajuan yang menunggu keputusan Director ===== */}
      {pending && (
        <section className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-lg font-semibold text-amber-900">
            Pengajuan Perubahan #{pending.id} — Menunggu Approval Director
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            Diajukan <strong>{nameOf(pending.requested_by)}</strong> pada{" "}
            {new Date(pending.requested_at).toLocaleString("id-ID")}. Nilai di bawah{" "}
            <strong>belum berlaku</strong> sampai Director menyetujui.
          </p>
          <p className="mt-2 rounded-md bg-white p-3 text-sm">
            <span className="text-xs uppercase text-slate-400">Alasan</span>
            <br />
            {pending.reason}
          </p>

          <div className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-amber-100/60 text-left text-xs uppercase text-amber-900">
                <tr>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Sekarang</th>
                  <th className="px-3 py-2">Diusulkan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {(Object.entries(pending.changes) as [EditableField, { before: unknown; after: unknown }][]).map(
                  ([field, c]) => (
                    <tr key={field}>
                      <td className="px-3 py-2 font-medium">{FIELD_LABELS[field] ?? field}</td>
                      <td className="px-3 py-2 text-slate-500 line-through">{displayValue(field, c.before)}</td>
                      <td className="px-3 py-2 font-semibold text-emerald-700">{displayValue(field, c.after)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          {canApprove ? (
            <form action={decideTransactionChange} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input type="hidden" name="request_id" value={pending.id} />
              <input
                name="decision_note"
                placeholder="Catatan keputusan (wajib bila menolak)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                name="decision"
                value="approve"
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Setujui &amp; Terapkan
              </button>
              <button
                type="submit"
                name="decision"
                value="reject"
                className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Tolak
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-amber-800">
              Hanya <strong>Director</strong> yang bisa menyetujui atau menolak pengajuan ini.
            </p>
          )}

          {canRequest && (
            <form action={cancelTransactionChange} className="mt-2">
              <input type="hidden" name="request_id" value={pending.id} />
              <button type="submit" className="text-xs text-slate-600 underline hover:text-slate-900">
                Batalkan pengajuan ini
              </button>
            </form>
          )}
        </section>
      )}

      {/* ===== Form ajukan perubahan (Senior/Lead Finance) ===== */}
      {canRequest ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Ajukan Perubahan Transaksi</h2>
          <p className="mt-1 text-sm text-slate-500">
            Ubah hanya field yang perlu. Field bertanda{" "}
            <span className="rounded bg-amber-100 px-1 text-xs font-medium text-amber-800">approval</span>{" "}
            baru berlaku setelah disetujui Director; sisanya berlaku langsung dan tetap masuk audit.
          </p>
          {pending ? (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Masih ada pengajuan menunggu keputusan Director. Batalkan pengajuan di atas dulu
              sebelum mengajukan perubahan baru.
            </p>
          ) : (
            <ChangeRequestForm transaction={txn} guardedFields={guardedFields} />
          )}
        </section>
      ) : (
        <p className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Perubahan transaksi hanya bisa diajukan <strong>Senior / Lead Finance</strong> (dan
          management), lalu disetujui Director. Role Anda ({member.role}) hanya membaca.
        </p>
      )}

      {/* ===== Riwayat pengajuan ===== */}
      <h2 className="mt-10 text-lg font-semibold">Riwayat Pengajuan Perubahan ({changes.length})</h2>
      <div className="mt-3 space-y-3">
        {changes.map((c) => (
          <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-500">#{c.id}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status]}`}>
                {STATUS_LABEL[c.status]}
              </span>
              <span className="text-xs text-slate-500">
                diajukan {nameOf(c.requested_by)} · {new Date(c.requested_at).toLocaleString("id-ID")}
              </span>
              {c.decided_at && (
                <span className="text-xs text-slate-500">
                  · diputuskan {nameOf(c.decided_by)} · {new Date(c.decided_at).toLocaleString("id-ID")}
                </span>
              )}
            </div>
            <ul className="mt-2 list-inside list-disc text-slate-700">
              {(Object.entries(c.changes) as [EditableField, { before: unknown; after: unknown }][]).map(
                ([field, ch]) => (
                  <li key={field}>
                    {FIELD_LABELS[field] ?? field}: {displayValue(field, ch.before)} →{" "}
                    <strong>{displayValue(field, ch.after)}</strong>
                  </li>
                ),
              )}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Alasan: {c.reason}</p>
            {c.decision_note && (
              <p className="mt-1 text-xs text-slate-500">Catatan keputusan: {c.decision_note}</p>
            )}
          </div>
        ))}
        {changes.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-slate-400">
            Belum ada pengajuan perubahan untuk transaksi ini.
          </p>
        )}
      </div>

      {/* ===== Audit trail transaksi ===== */}
      <h2 className="mt-10 text-lg font-semibold">Audit Transaksi</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Waktu</th>
              <th className="px-3 py-3">Aksi</th>
              <th className="px-3 py-3">Tipe</th>
              <th className="px-3 py-3">Aktor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(auditRows ?? []).map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 text-xs">{new Date(a.created_at).toLocaleString("id-ID")}</td>
                <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                <td className="px-3 py-2 text-xs">{a.type}</td>
                <td className="px-3 py-2 text-xs">{nameOf(a.actor_id)}</td>
              </tr>
            ))}
            {(auditRows ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Belum ada entri audit untuk transaksi ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, hasPermission, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { rupiah } from "@/lib/utils/format";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_TERMS,
  PAYMENT_TERMS_LABELS,
  TXN_DIRECTIONS,
  TXN_DIRECTION_LABELS,
  type PaymentStatus,
} from "@/lib/finance/transaction";
import { createTransaction } from "./actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "text-xs font-medium text-slate-600";

const STATUS_STYLE: Record<PaymentStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  partial: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
};

interface TxnRow {
  id: string;
  client_name: string;
  amount: number;
  payment_method: keyof typeof PAYMENT_METHOD_LABELS;
  payment_status: PaymentStatus;
  due_date: string | null;
  invoice_no: string | null;
}

export default async function FinanceTransactionsPage() {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/finance/transactions")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const canCreate = hasPermission("finance.transaction_create", member.role);
  const canApprove = hasPermission("finance.approve_change", member.role);
  const supabase = await createClient();

  const [{ data: rows }, { data: pending }] = await Promise.all([
    supabase
      .from("finance_transactions")
      .select("id, client_name, amount, payment_method, payment_status, due_date, invoice_no")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("finance_transaction_changes")
      .select("id, transaction_id, requested_at")
      .eq("status", "menunggu")
      .order("requested_at", { ascending: true }),
  ]);

  const transactions = (rows ?? []) as TxnRow[];
  const pendingByTxn = new Map((pending ?? []).map((p) => [p.transaction_id, p.id]));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Transaksi Finance</h1>
      <p className="mt-1 text-sm text-slate-500">
        Catatan pembayaran klien. Perubahan metode/nominal pembayaran diajukan Senior/Lead
        Finance dan baru berlaku setelah <strong>approval Director</strong>.
      </p>

      {(pending ?? []).length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">
            {(pending ?? []).length} pengajuan perubahan menunggu approval Director
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(pending ?? []).map((p) => (
              <Link
                key={p.id}
                href={`/finance/transactions/${p.transaction_id}`}
                className="rounded-full bg-white px-3 py-1 font-mono text-xs text-amber-900 underline"
              >
                {p.transaction_id}
              </Link>
            ))}
          </div>
          {!canApprove && (
            <p className="mt-2 text-xs text-amber-800">
              Hanya Director yang bisa menyetujui atau menolak.
            </p>
          )}
        </div>
      )}

      {canCreate && (
        <details className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium">+ Catat transaksi baru</summary>
          <p className="mt-2 text-xs text-slate-500">
            Nomor transaksi (TRX-YYYYMM-NNNN) dibuat otomatis berurutan per bulan.
          </p>
          <form action={createTransaction} className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <p className={label}>Arah transaksi</p>
              <select name="direction" defaultValue="masuk" className={`${input} mt-1 w-full`}>
                {TXN_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>{TXN_DIRECTION_LABELS[d]}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <p className={label}>Nama klien / brand (sesuai display platform)</p>
              <input name="client_name" required className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <p className={label}>Nominal</p>
              <input name="amount" required placeholder="Rp75.000.000" className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <p className={label}>Metode pembayaran</p>
              <select name="payment_method" required className={`${input} mt-1 w-full`}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <p className={label}>Termin</p>
              <select name="payment_terms" defaultValue="invoice" className={`${input} mt-1 w-full`}>
                {PAYMENT_TERMS.map((t) => (
                  <option key={t} value={t}>{PAYMENT_TERMS_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <p className={label}>Status pembayaran</p>
              <select name="payment_status" defaultValue="pending" className={`${input} mt-1 w-full`}>
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <p className={label}>Nomor invoice (opsional)</p>
              <input name="invoice_no" className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <p className={label}>Jatuh tempo (opsional)</p>
              <input type="date" name="due_date" className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <p className={label}>Deal terkait (opsional)</p>
              <input name="deal_id" placeholder="DEAL-XXXXX" className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <p className={label}>Bank tujuan</p>
              <input name="bank_name" className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <p className={label}>Nomor rekening</p>
              <input name="bank_account_no" className={`${input} mt-1 w-full`} />
            </div>
            <div>
              <p className={label}>Nama pemilik rekening</p>
              <input name="bank_account_name" className={`${input} mt-1 w-full`} />
            </div>
            <div className="sm:col-span-3">
              <p className={label}>Keterangan (opsional)</p>
              <input name="notes" className={`${input} mt-1 w-full`} />
            </div>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 sm:col-span-3"
            >
              Simpan Transaksi
            </button>
          </form>
        </details>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Nomor Transaksi</th>
              <th className="px-3 py-3">Klien / Brand</th>
              <th className="px-3 py-3">Invoice</th>
              <th className="px-3 py-3">Nominal</th>
              <th className="px-3 py-3">Metode</th>
              <th className="px-3 py-3">Jatuh Tempo</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Approval</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/finance/transactions/${t.id}`} className="text-blue-700 underline">
                    {t.id}
                  </Link>
                </td>
                <td className="px-3 py-2 font-medium">{t.client_name}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{t.invoice_no ?? "—"}</td>
                <td className="px-3 py-2">{rupiah(t.amount)}</td>
                <td className="px-3 py-2">{PAYMENT_METHOD_LABELS[t.payment_method] ?? t.payment_method}</td>
                <td className="px-3 py-2">{t.due_date ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.payment_status]}`}>
                    {PAYMENT_STATUS_LABELS[t.payment_status]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {pendingByTxn.has(t.id) ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      menunggu Director
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  Belum ada transaksi tercatat.
                  {canCreate ? " Catat lewat form di atas." : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

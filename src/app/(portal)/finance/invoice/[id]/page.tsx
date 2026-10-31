import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { loadInvoice, loadInvoiceEvents } from "@/lib/m10/invoice-data";
import { INVOICE_STATUS_LABELS } from "@/lib/m10/request";
import { FUNDING_LABELS } from "@/lib/m10/funding-spec";
import { rupiah } from "@/lib/utils/format";
import { InvoiceActions } from "./invoice-actions";

const REMINDER_STYLE: Record<string, string> = {
  aman: "bg-slate-100 text-slate-600",
  segera: "bg-amber-100 text-amber-800",
  jatuh_tempo: "bg-red-100 text-red-800",
};
const EVENT_LABEL: Record<string, string> = {
  dibuat: "Dibuat", dikirim: "Dikirim ke pembayar", diingatkan: "Pengingat sistem", dibayar: "Dibayar", dibatalkan: "Dibatalkan",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireMember();
  if (!hasPermission("finance.view", member.role) && member.role !== "od_viewer") redirect("/dashboard");
  const canManage = hasPermission("finance.invoice_manage", member.role);

  const [invoice, events] = await Promise.all([loadInvoice(id), loadInvoiceEvents(id)]);
  if (!invoice) notFound();

  return (
    <div className="max-w-5xl space-y-4">
      <header>
        <Link href="/finance" className="text-xs text-slate-500 hover:underline">← Finance</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Invoice {invoice.id}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">{INVOICE_STATUS_LABELS[invoice.status]}</span>
          {invoice.status === "terbit" && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REMINDER_STYLE[invoice.reminder]}`}>
              {invoice.reminder === "jatuh_tempo" ? "Lewat jatuh tempo" : invoice.reminder === "segera" ? "Segera jatuh tempo" : "Belum jatuh tempo"}
            </span>
          )}
          <a href={`/finance/invoice/${invoice.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Unduh PDF
          </a>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
            <Field label="Ditagihkan kepada">{invoice.billToName} <span className="text-xs text-slate-400">({invoice.billToType})</span>{invoice.billToDetail && <span className="block text-xs text-slate-500 whitespace-pre-line">{invoice.billToDetail}</span>}</Field>
            <Field label="Request">
              <Link href={`/ads/${invoice.requestId}`} className="text-blue-700 hover:underline">#{invoice.requestId}</Link>
              {invoice.fundingType ? ` · ${FUNDING_LABELS[invoice.fundingType]}` : ""}
              {invoice.creatorName ? ` · ${invoice.creatorName}` : ""}
              {invoice.projectName ? ` · ${invoice.projectName}` : ""}
              {invoice.slotDate ? ` · live ${invoice.slotDate}` : ""}
            </Field>
            <Field label="Terbit">{invoice.issuedAt}</Field>
            <Field label="Jatuh tempo">{invoice.dueDate}</Field>
            <Field label="DPP">{rupiah(invoice.dpp)}</Field>
            <Field label={`PPN ${(invoice.ppnRate * 100).toFixed(0)}%`}>{rupiah(invoice.ppn)}</Field>
            <Field label="Total"><strong>{rupiah(invoice.total)}</strong></Field>
            <Field label="Pembayaran">{invoice.paidAt ? `${invoice.paidAt} · ${rupiah(invoice.paidAmount)}` : "—"}{invoice.proofUrl && <a href={invoice.proofUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs text-blue-700 hover:underline">bukti</a>}</Field>
            {invoice.note && <Field label="Catatan">{invoice.note}</Field>}
          </div>

          <div>
            <h2 className="text-sm font-semibold">Riwayat invoice (immutable)</h2>
            <ul className="mt-1 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="text-slate-400">{e.createdAt.slice(0, 16).replace("T", " ")}</span>{" "}
                  <span className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</span> · {e.actorName ?? e.actorLabel ?? "sistem"}
                  {e.payload ? <span className="text-slate-400"> · {JSON.stringify(e.payload)}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside>
          {canManage ? (
            <InvoiceActions invoiceId={invoice.id} total={invoice.total} status={invoice.status} billToName={invoice.billToName} />
          ) : (
            <p className="text-sm text-slate-500">Hanya Finance yang mencatat pembayaran / membatalkan invoice.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

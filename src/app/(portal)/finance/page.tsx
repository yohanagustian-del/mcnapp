import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { loadAdsRequests, MIGRATION_0100_MISSING } from "@/lib/m10/request-data";
import { loadInvoices } from "@/lib/m10/invoice-data";
import { canAccRequest, type RequestStatus } from "@/lib/m10/request";
import { fundingNeedsCashCheck } from "@/lib/m10/funding-spec";
import { FundingBadge, RequestStatusBadge } from "@/components/ads-request-badge";
import { rupiah } from "@/lib/utils/format";

const REMINDER_STYLE: Record<string, string> = {
  aman: "bg-slate-100 text-slate-600",
  segera: "bg-amber-100 text-amber-800",
  jatuh_tempo: "bg-red-100 text-red-800",
};

/**
 * Finance Ads & Penagihan (D-2026-10-31-3/6): antrean ACC request ads, cek uang masuk
 * (cash di awal), invoice & piutang (jatuh tempo dihitung saat render), alert pengingat.
 * Read-only untuk od_viewer & Head CM yang bukan pemegang finance.invoice_manage.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ inv?: string }> }) {
  const member = await requireMember();
  if (!hasPermission("finance.view", member.role) && member.role !== "od_viewer") redirect("/dashboard");
  const canReview = hasPermission("finance.ads_review", member.role);
  const { inv: invFilter } = await searchParams;

  const [queue, invoices] = await Promise.all([
    loadAdsRequests({ statuses: ["menunggu_finance", "diajukan", "menunggu_approval_director"] as RequestStatus[] }),
    loadInvoices({ statuses: invFilter === "semua" ? undefined : invFilter === "lunas" ? ["lunas"] : ["terbit"], limit: 400 }),
  ]);

  const waiting = queue.rows.filter((r) => r.status === "menunggu_finance" || r.status === "diajukan");
  const cashPending = waiting.filter((r) => r.fundingType && fundingNeedsCashCheck(r.fundingType, r.paymentMethod) && !r.cashReceivedAt);
  const mine = waiting.filter((r) => r.fundingType && canAccRequest(member.role, r.fundingType, r.paymentMethod));
  const directorQueue = queue.rows.filter((r) => r.status === "menunggu_approval_director");

  const open = invoices.rows.filter((i) => i.status === "terbit");
  const piutang = open.reduce((s, i) => s + i.total, 0);
  const overdue = open.filter((i) => i.reminder === "jatuh_tempo");
  const soon = open.filter((i) => i.reminder === "segera");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Finance — Ads &amp; Penagihan</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cek &amp; ACC request ads, catat uang masuk (cash di awal), terbitkan &amp; tagih invoice (PPN otomatis), catat tanggal bayar.
          Pengingat: H-{invoices.config.reminderDays} dan setelah jatuh tempo ({invoices.config.dueDays} hari sejak terbit).
        </p>
      </header>

      {(!queue.ok && queue.migrationMissing) || (!invoices.ok && invoices.migrationMissing) ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{MIGRATION_0100_MISSING}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Menunggu ACC" value={String(waiting.length)} sub={`${mine.length} bisa Anda ACC`} />
        <Stat label="Cash belum tercatat masuk" value={String(cashPending.length)} tone={cashPending.length ? "amber" : undefined} />
        <Stat label="Piutang invoice terbit" value={rupiah(piutang)} sub={`${open.length} invoice`} />
        <Stat label="Jatuh tempo / segera" value={`${overdue.length} / ${soon.length}`} tone={overdue.length ? "red" : soon.length ? "amber" : undefined} />
      </div>

      {directorQueue.length > 0 && (
        <p className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
          {directorQueue.length} request Budget MEA melebihi jatah sedang menunggu approval Director —{" "}
          <Link href="/ads?view=director" className="underline">lihat</Link>.
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold">Antrean ACC request ads</h2>
        <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th><th className="px-3 py-2">Untuk</th><th className="px-3 py-2">Kreator / pembayar</th>
                <th className="px-3 py-2">Pendanaan</th><th className="px-3 py-2 text-right">Budget</th><th className="px-3 py-2">Uang masuk</th>
                <th className="px-3 py-2">Pemohon</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {waiting.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Tidak ada request menunggu ACC.</td></tr>}
              {waiting.map((r) => {
                const isCash = !!r.fundingType && fundingNeedsCashCheck(r.fundingType, r.paymentMethod);
                const can = canReview && !!r.fundingType && canAccRequest(member.role, r.fundingType, r.paymentMethod);
                return (
                  <tr key={r.id} className={isCash && !r.cashReceivedAt ? "bg-amber-50/50" : ""}>
                    <td className="px-3 py-2"><Link href={`/ads/${r.id}`} className="font-medium text-blue-700 hover:underline">#{r.id}</Link></td>
                    <td className="px-3 py-2">{r.scheduleSlotId ? `Live ${r.slotDate}${r.slotBrand ? ` · ${r.slotBrand}` : ""}` : r.projectName ? `Project ${r.projectName}` : "—"}</td>
                    <td className="px-3 py-2">{r.creatorName ?? "—"}{r.payerName ? <span className="block text-xs text-slate-500">bayar: {r.payerName}</span> : null}</td>
                    <td className="px-3 py-2"><FundingBadge fundingType={r.fundingType} paymentMethod={r.paymentMethod} /></td>
                    <td className="px-3 py-2 text-right">{rupiah(r.budgetRequested)}</td>
                    <td className="px-3 py-2">{isCash ? (r.cashReceivedAt ?? <span className="text-amber-700">belum</span>) : <span className="text-slate-400">n/a</span>}</td>
                    <td className="px-3 py-2">{r.requestedByName ?? "—"}</td>
                    <td className="px-3 py-2"><RequestStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2">
                      {can ? <Link href={`/ads/${r.id}`} className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-700">Proses</Link>
                        : <span className="text-xs text-slate-400">{isCash ? "ACC oleh Finance" : "ACC Head CM / Finance"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Invoice &amp; piutang</h2>
          <nav className="flex gap-2 text-xs">
            {[{ k: "terbit", l: "Terbit (belum lunas)" }, { k: "lunas", l: "Lunas" }, { k: "semua", l: "Semua" }].map((o) => (
              <Link key={o.k} href={`/finance?inv=${o.k}`} className={`rounded-full px-3 py-1 ${(invFilter ?? "terbit") === o.k ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}>{o.l}</Link>
            ))}
          </nav>
        </div>
        <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Ditagihkan</th><th className="px-3 py-2">Request</th>
                <th className="px-3 py-2 text-right">Total (incl. PPN)</th><th className="px-3 py-2">Terbit</th><th className="px-3 py-2">Jatuh tempo</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2">Dibayar</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Belum ada invoice.</td></tr>}
              {invoices.rows.map((i) => (
                <tr key={i.id} className={i.reminder === "jatuh_tempo" ? "bg-red-50/50" : i.reminder === "segera" ? "bg-amber-50/50" : ""}>
                  <td className="px-3 py-2"><Link href={`/finance/invoice/${i.id}`} className="font-medium text-blue-700 hover:underline">{i.id}</Link></td>
                  <td className="px-3 py-2">{i.billToName} <span className="text-xs text-slate-400">({i.billToType})</span></td>
                  <td className="px-3 py-2"><Link href={`/ads/${i.requestId}`} className="text-blue-700 hover:underline">#{i.requestId}</Link>{i.creatorName ? ` · ${i.creatorName}` : ""}</td>
                  <td className="px-3 py-2 text-right">{rupiah(i.total)}</td>
                  <td className="px-3 py-2">{i.issuedAt}</td>
                  <td className="px-3 py-2">
                    {i.dueDate}
                    {i.status === "terbit" && i.reminder !== "aman" && (
                      <span className={`ml-1 rounded px-1 text-[10px] ${REMINDER_STYLE[i.reminder]}`}>{i.reminder === "jatuh_tempo" ? "lewat" : "segera"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{i.status}</td>
                  <td className="px-3 py-2">{i.paidAt ?? "—"}</td>
                  <td className="px-3 py-2"><a href={`/finance/invoice/${i.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "amber" | "red" }) {
  const toneCls = tone === "red" ? "border-red-200 bg-red-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white";
  return (
    <div className={`rounded-lg border p-4 ${toneCls}`}>
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

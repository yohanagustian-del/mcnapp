import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission, MANAGEMENT_ROLES } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCreatorInScope } from "@/lib/schedule/scope";
import { loadAdsRequest, loadMeaBudgetContext } from "@/lib/m10/request-data";
import { canAccRequest } from "@/lib/m10/request";
import { FUNDING_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/m10/funding-spec";
import { FundingBadge, RequestStatusBadge } from "@/components/ads-request-badge";
import { rupiah } from "@/lib/utils/format";
import { RequestActions, type RequestCapabilities } from "./request-actions";

export default async function AdsRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  const { id } = await params;
  const { msg } = await searchParams;
  const requestId = Number(id);
  if (!Number.isInteger(requestId)) notFound();

  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/ads")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const request = await loadAdsRequest(requestId);
  if (!request) notFound();
  if (member.role === "cpm" && !isCreatorInScope(member, request.creatorOwnerCpmId)) {
    redirect("/ads");
  }

  const admin = createAdminClient();
  const [{ data: results }, { data: audits }] = await Promise.all([
    admin.from("ads_campaign_results").select("id, period, ads_spent, gmv, cpm, ctr, cvr, roas, status, flagged, created_at").eq("brief_id", requestId).order("period"),
    admin.from("audit_logs").select("id, action, actor_id, actor_label, before, after, type, created_at, team_members(name)").eq("entity_type", "ads_briefs").eq("entity_id", String(requestId)).order("created_at"),
  ]);

  let meaCtx = null;
  if (request.fundingType === "mea_budget" && request.creatorId && request.budgetMonth) {
    try {
      meaCtx = await loadMeaBudgetContext(request.creatorId, request.budgetMonth, null, requestId);
    } catch {
      meaCtx = null;
    }
  }

  const caps: RequestCapabilities = {
    canDirector: hasPermission("m10.budget_approve", member.role),
    canAcc: hasPermission("finance.ads_review", member.role) && !!request.fundingType && canAccRequest(member.role, request.fundingType, request.paymentMethod),
    canRecordCash: hasPermission("finance.invoice_manage", member.role),
    canExecute: hasPermission("m10.brief_execute", member.role),
    canInputResult: hasPermission("m10.result_input", member.role),
    canCancel: request.requestedById === member.id || MANAGEMENT_ROLES.includes(member.role) || hasPermission("finance.ads_review", member.role),
  };

  const owner = request.scheduleSlotId
    ? { label: `Slot Jadwal Live · ${request.slotDate ?? ""}${request.slotBrand ? ` · ${request.slotBrand}` : ""}`, href: `/schedule/live/${request.scheduleSlotId}` }
    : request.projectId
    ? { label: `Special Project · ${request.projectName ?? request.projectId}`, href: `/projects/${request.projectId}` }
    : request.dealId
    ? { label: `Deal ${request.dealId} (brief lama)`, href: `/deals/${request.dealId}` }
    : null;

  return (
    <div className="max-w-5xl space-y-4">
      <header>
        <Link href="/ads" className="text-xs text-slate-500 hover:underline">← Request Ads</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Request Ads #{request.id}</h1>
          <RequestStatusBadge status={request.status} />
          <FundingBadge fundingType={request.fundingType} paymentMethod={request.paymentMethod} />
        </div>
        {msg && <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{msg}</p>}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
            <Field label="Untuk">{owner ? <Link href={owner.href} className="text-blue-700 hover:underline">{owner.label}</Link> : "—"}</Field>
            <Field label="Kreator">{request.creatorId ? <Link href={`/creators/${request.creatorId}`} className="text-blue-700 hover:underline">{request.creatorName ?? request.creatorId}</Link> : "—"}</Field>
            <Field label="Pendanaan">{request.fundingType ? FUNDING_LABELS[request.fundingType] : "— (brief lama)"}{request.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[request.paymentMethod]}` : ""}</Field>
            <Field label="Pembayar">{request.payerName ?? "—"}</Field>
            <Field label="Budget diminta">{rupiah(request.budgetRequested)}</Field>
            <Field label="Budget disetujui">{rupiah(request.budgetApproved)}</Field>
            <Field label="Periode ads">{request.periodStart ?? "—"}{request.periodEnd && request.periodEnd !== request.periodStart ? ` → ${request.periodEnd}` : ""}</Field>
            <Field label="Objektif">{request.objective ?? "—"}</Field>
            <Field label="Catatan">{request.notes ?? "—"}</Field>
            <Field label="Pemohon">{request.requestedByName ?? "—"} · {request.createdAt.slice(0, 16).replace("T", " ")}</Field>
            <Field label="ACC">
              {request.financeStatus === "belum_dicek" ? "belum dicek" : `${request.financeStatus} oleh ${request.financeCheckedByName ?? "?"} ${request.financeCheckedAt ? `· ${request.financeCheckedAt.slice(0, 16).replace("T", " ")}` : ""}`}
              {request.financeNote && <span className="block text-xs text-slate-500">{request.financeNote}</span>}
            </Field>
            <Field label="Uang masuk (cash)">{request.cashReceivedAt ?? "—"}</Field>
            <Field label="Executor">{request.executedByName ?? "—"}{request.executedAt ? ` · ${request.executedAt.slice(0, 16).replace("T", " ")}` : ""}</Field>
            <Field label="Invoice">
              {request.invoice ? (
                <Link href={`/finance/invoice/${request.invoice.id}`} className="text-blue-700 hover:underline">
                  {request.invoice.id} · {request.invoice.status} · {rupiah(request.invoice.total)} · jatuh tempo {request.invoice.dueDate}
                </Link>
              ) : "—"}
            </Field>
            {request.cancelledReason && <Field label="Alasan batal">{request.cancelledReason}</Field>}
          </div>

          {meaCtx && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              Jatah Budget MEA {request.budgetMonth?.slice(0, 7)} kreator ini: {rupiah(meaCtx.budget)} · terpakai request lain {rupiah(meaCtx.used)} · sisa {rupiah(meaCtx.remaining)}.
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold">Realisasi ads (ads_campaign_results)</h2>
            <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2">Periode</th><th className="px-3 py-2 text-right">Ads spent</th><th className="px-3 py-2 text-right">GMV</th><th className="px-3 py-2">ROAS</th><th className="px-3 py-2">CPM/CTR/CVR</th><th className="px-3 py-2">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(results ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">Belum ada realisasi.</td></tr>}
                  {(results ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">{r.period}</td>
                      <td className="px-3 py-2 text-right">{rupiah(Number(r.ads_spent))}</td>
                      <td className="px-3 py-2 text-right">{rupiah(Number(r.gmv))}</td>
                      <td className="px-3 py-2">{r.roas ?? "—"}{r.flagged && <span className="ml-1 text-xs text-red-600">⚠ review</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{r.cpm ?? "—"} / {r.ctr ?? "—"} / {r.cvr ?? "—"}</td>
                      <td className="px-3 py-2">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
                {(results ?? []).length > 0 && (
                  <tfoot className="bg-slate-50 text-sm font-medium">
                    <tr><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{rupiah(request.adsSpent)}</td><td colSpan={4} /></tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold">Riwayat (audit_logs)</h2>
            <ul className="mt-1 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
              {(audits ?? []).length === 0 && <li className="text-slate-400">Belum ada riwayat.</li>}
              {(audits ?? []).map((a) => {
                const tm = a.team_members as unknown as { name?: string } | null;
                const after = a.after as { status?: string } | null;
                return (
                  <li key={a.id}>
                    <span className="text-slate-400">{String(a.created_at).slice(0, 16).replace("T", " ")}</span>{" "}
                    <span className="font-medium">{a.action}</span> · {tm?.name ?? a.actor_label ?? "sistem"}
                    {after?.status ? ` → ${after.status}` : ""}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <aside>
          <RequestActions request={request} caps={caps} />
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

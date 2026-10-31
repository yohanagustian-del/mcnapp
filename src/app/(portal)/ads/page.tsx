import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { loadAdsRequests, MIGRATION_0100_MISSING, type AdsRequestRow } from "@/lib/m10/request-data";
import { OPEN_STATUSES, type RequestStatus } from "@/lib/m10/request";
import { FundingBadge, RequestStatusBadge } from "@/components/ads-request-badge";
import { rupiah } from "@/lib/utils/format";

type View = "semua" | "saya" | "eksekusi" | "acc" | "director";

const VIEWS: { key: View; label: string; show: (role: string) => boolean }[] = [
  { key: "semua", label: "Semua", show: () => true },
  { key: "saya", label: "Request saya", show: (r) => hasPermission("m10.brief_create", r as never) },
  { key: "eksekusi", label: "Antrean eksekusi", show: (r) => hasPermission("m10.brief_execute", r as never) },
  { key: "acc", label: "Menunggu ACC", show: (r) => hasPermission("finance.ads_review", r as never) },
  { key: "director", label: "Approval Director", show: (r) => hasPermission("m10.budget_approve", r as never) },
];

/**
 * Request Ads (D-2026-10-31) — satu daftar untuk pembuat (CM/BizDev/Campaign Ops),
 * executor (Creator Support), yang meng-ACC (Head CM/Finance), dan management.
 * Request dibuat DARI slot Jadwal Live atau Special Project (tombol di sana),
 * atau dari /ads/baru dengan memilih project.
 */
export default async function AdsRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/ads")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const params = await searchParams;
  const views = VIEWS.filter((v) => v.show(member.role));
  const view = (views.find((v) => v.key === params.view)?.key ?? "semua") as View;

  const isCpm = member.role === "cpm";
  const opts =
    view === "saya" ? { requestedBy: member.id }
    : view === "eksekusi" ? { statuses: ["siap_dieksekusi", "dikerjakan", "baru"] as RequestStatus[] }
    : view === "acc" ? { statuses: ["menunggu_finance", "diajukan"] as RequestStatus[] }
    : view === "director" ? { statuses: ["menunggu_approval_director", "menunggu_approval"] as RequestStatus[] }
    : {};
  const res = await loadAdsRequests({ ...opts, ownerCpmId: isCpm ? member.id : null });
  let rows: AdsRequestRow[] = res.rows;
  if (params.status === "terbuka") rows = rows.filter((r) => OPEN_STATUSES.includes(r.status));

  const canCreate = hasPermission("m10.brief_create", member.role);
  const canSetBudget = hasPermission("m10.mea_budget_set", member.role);
  const openCount = res.rows.filter((r) => OPEN_STATUSES.includes(r.status)).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Request Ads</h1>
          <p className="mt-1 text-sm text-slate-500">
            Request ads untuk sesi Jadwal Live &amp; Special Project: pendanaan (Budget MEA / Creator / Brand /
            TikTok Ads Credit) → ACC Head CM/Finance → eksekusi Creator Support → realisasi ads spent.
            {isCpm && " Anda hanya melihat request kreator yang Anda pegang."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSetBudget && (
            <Link href="/ads/jatah" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Jatah Budget MEA
            </Link>
          )}
          {canCreate && (
            <Link href="/ads/baru" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
              + Request Ads
            </Link>
          )}
        </div>
      </header>

      {!res.ok && res.migrationMissing && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{MIGRATION_0100_MISSING}</p>
      )}
      {!res.ok && !res.migrationMissing && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Gagal memuat: {res.error}</p>
      )}

      <nav className="flex flex-wrap gap-2 text-sm">
        {views.map((v) => (
          <Link
            key={v.key}
            href={`/ads?view=${v.key}`}
            className={`rounded-full px-3 py-1 ${view === v.key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
          >
            {v.label}
          </Link>
        ))}
        <Link
          href={`/ads?view=${view}${params.status === "terbuka" ? "" : "&status=terbuka"}`}
          className={`rounded-full px-3 py-1 ${params.status === "terbuka" ? "bg-amber-600 text-white" : "border border-amber-300 text-amber-800 hover:bg-amber-50"}`}
        >
          Hanya yang masih berjalan ({openCount})
        </Link>
      </nav>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Untuk</th>
              <th className="px-3 py-2">Kreator</th>
              <th className="px-3 py-2">Pendanaan</th>
              <th className="px-3 py-2 text-right">Budget</th>
              <th className="px-3 py-2 text-right">Realisasi</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Pemohon</th>
              <th className="px-3 py-2">Executor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Belum ada request ads.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-2"><Link href={`/ads/${r.id}`} className="font-medium text-blue-700 hover:underline">#{r.id}</Link></td>
                <td className="px-3 py-2">
                  {r.scheduleSlotId ? (
                    <span>Live {r.slotDate}{r.slotBrand ? ` · ${r.slotBrand}` : ""}</span>
                  ) : r.projectId ? (
                    <Link href={`/projects/${r.projectId}`} className="text-blue-700 hover:underline">Project: {r.projectName ?? r.projectId}</Link>
                  ) : r.dealId ? <span className="text-slate-500">Deal {r.dealId} (lama)</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2">{r.creatorName ?? r.creatorId ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2"><FundingBadge fundingType={r.fundingType} paymentMethod={r.paymentMethod} /></td>
                <td className="px-3 py-2 text-right">{rupiah(r.budgetApproved ?? r.budgetRequested)}</td>
                <td className="px-3 py-2 text-right">{r.resultCount ? rupiah(r.adsSpent) : <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2"><RequestStatusBadge status={r.status} /></td>
                <td className="px-3 py-2">
                  {r.invoice ? (
                    <Link href={`/finance/invoice/${r.invoice.id}`} className="text-blue-700 hover:underline">
                      {r.invoice.id} · {r.invoice.status}
                    </Link>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2">{r.requestedByName ?? "—"}</td>
                <td className="px-3 py-2">{r.executedByName ?? <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

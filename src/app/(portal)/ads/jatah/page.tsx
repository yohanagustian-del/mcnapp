import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayWib } from "@/lib/utils/date";
import { loadMeaBudgetList, MIGRATION_0100_MISSING } from "@/lib/m10/request-data";
import { rupiah } from "@/lib/utils/format";
import { MeaBudgetForm } from "./mea-budget-form";

/**
 * Jatah Budget MEA per kreator per bulan (D-2026-10-31-4) — ditetapkan Head/Director.
 * Terpakai dibaca dari view creator_mea_budget_usage_v (SQL), sisa bulan hangus.
 */
export default async function MeaBudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const member = await requireMember();
  if (!hasPermission("m10.mea_budget_set", member.role) && !hasPermission("finance.view", member.role)) redirect("/ads");
  const canSet = hasPermission("m10.mea_budget_set", member.role);

  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? (params.month as string) : todayWib().slice(0, 7);
  const monthIso = `${month}-01`;

  const [{ rows, migrationMissing }, { data: creatorRows }] = await Promise.all([
    loadMeaBudgetList(monthIso),
    createAdminClient().from("creators").select("id, name, username").eq("status", "aktif").order("name").limit(3000),
  ]);
  const creators = ((creatorRows ?? []) as { id: string; name: string; username: string | null }[]);
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalUsed = rows.reduce((s, r) => s + r.used, 0);

  const prev = new Date(Date.parse(`${monthIso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7);
  const next = new Date(Date.parse(`${monthIso}T00:00:00Z`) + 32 * 86_400_000).toISOString().slice(0, 7);

  return (
    <div className="space-y-4">
      <header>
        <Link href="/ads" className="text-xs text-slate-500 hover:underline">← Request Ads</Link>
        <h1 className="mt-1 text-xl font-semibold">Jatah Budget MEA per Kreator</h1>
        <p className="mt-1 text-sm text-slate-500">
          Jatah ads yang dibayar MEA untuk tiap kreator per bulan. Tanpa baris = 0. Sisa bulan hangus.
          Request Budget MEA yang melebihi sisa jatah butuh approval Director.
        </p>
      </header>

      {migrationMissing && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{MIGRATION_0100_MISSING}</p>}

      <div className="flex items-center gap-2 text-sm">
        <Link href={`/ads/jatah?month=${prev}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">‹ {prev}</Link>
        <span className="font-medium">{month}</span>
        <Link href={`/ads/jatah?month=${next}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">{next} ›</Link>
        <span className="ml-4 text-slate-500">Total jatah {rupiah(totalBudget)} · terpakai {rupiah(totalUsed)}</span>
      </div>

      {canSet && <MeaBudgetForm month={month} creators={creators} />}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Kreator</th>
              <th className="px-3 py-2 text-right">Jatah</th>
              <th className="px-3 py-2 text-right">Terpakai</th>
              <th className="px-3 py-2 text-right">Sisa</th>
              <th className="px-3 py-2">Catatan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Belum ada jatah untuk bulan ini.</td></tr>}
            {rows.map((r) => (
              <tr key={r.creatorId} className={r.remaining === 0 && r.used > 0 ? "bg-amber-50" : ""}>
                <td className="px-3 py-2">
                  <Link href={`/creators/${r.creatorId}`} className="text-blue-700 hover:underline">{r.creatorName}</Link>
                  {r.username && <span className="ml-1 text-xs text-slate-400">@{r.username}</span>}
                </td>
                <td className="px-3 py-2 text-right">{rupiah(r.budget)}</td>
                <td className="px-3 py-2 text-right">{rupiah(r.used)}</td>
                <td className={`px-3 py-2 text-right ${r.remaining === 0 ? "text-amber-700" : ""}`}>{rupiah(r.remaining)}</td>
                <td className="px-3 py-2 text-slate-500">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

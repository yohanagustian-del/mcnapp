import { requireMember, hasPermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBrief, decideBriefApproval, claimBrief, inputResult } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  baru: "Baru", menunggu_approval: "Menunggu approval Director",
  dikerjakan: "Dikerjakan", selesai: "Selesai", batal: "Batal",
};

/** M10 Ads Support workspace (internal). Brief queue + Director approval + result input. */
export default async function AdsWorkspacePage() {
  const member = await requireMember();
  const admin = createAdminClient();

  // ===== Wave 1: independent lookups =====
  const [{ data: briefs }, { data: results }] = await Promise.all([
    admin
      .from("ads_briefs")
      .select("id, source, creator_id, deal_id, objective, budget_requested, status, assigned_to")
      .order("created_at", { ascending: false }).limit(50),
    admin
      .from("ads_campaign_results")
      .select("id, brief_id, period, ads_spent, gmv, roas, flagged, status")
      .order("period", { ascending: false }).limit(50),
  ]);

  const canApprove = hasPermission("m10.budget_approve", member.role);
  const canExecute = hasPermission("m10.brief_execute", member.role);
  const canInput = hasPermission("m10.result_input", member.role);
  const canCreate = hasPermission("m10.brief_create", member.role);
  const pending = (briefs ?? []).filter((b) => b.status === "menunggu_approval");

  return (
    <div className="space-y-6 p-2">
      <header>
        <h1 className="text-xl font-semibold">Campaign &amp; Ads Support (M10)</h1>
        <p className="text-sm text-slate-500">Brief → eksekusi → report ROAS. ads_spent = sumber tunggal (feed M7/M8).</p>
      </header>

      {canCreate && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Buat Brief</h2>
          <form action={createBrief} className="grid gap-2 md:grid-cols-3">
            <select name="source" required className="rounded border border-slate-300 p-2 text-sm">
              <option value="cm">CM (creator)</option><option value="bizdev">BizDev (deal)</option>
            </select>
            <input name="creator_id" placeholder="creator_id (opsional)" className="rounded border border-slate-300 p-2 text-sm" />
            <input name="deal_id" placeholder="deal_id (opsional)" className="rounded border border-slate-300 p-2 text-sm" />
            <input name="project_id" type="number" placeholder="project_id (opsional)" className="rounded border border-slate-300 p-2 text-sm" />
            <input name="budget_requested" placeholder="Budget (Rp)" className="rounded border border-slate-300 p-2 text-sm" />
            <input name="objective" placeholder="Objektif" className="rounded border border-slate-300 p-2 text-sm" />
            <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white md:col-span-3">Buat brief</button>
          </form>
        </section>
      )}

      {canApprove && pending.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-medium">Approval Director ({pending.length})</h2>
          {pending.map((b) => (
            <div key={b.id} className="flex items-center justify-between border-t border-amber-100 py-2 text-sm">
              <span>#{b.id} · budget {Number(b.budget_requested ?? 0).toLocaleString("id-ID")}</span>
              <div className="flex gap-2">
                <form action={decideBriefApproval}><input type="hidden" name="brief_id" value={b.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="rounded bg-green-600 px-3 py-1 text-xs text-white">Approve</button></form>
                <form action={decideBriefApproval}><input type="hidden" name="brief_id" value={b.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <button className="rounded bg-red-600 px-3 py-1 text-xs text-white">Tolak</button></form>
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Brief</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">#</th><th className="p-2">Sumber</th><th className="p-2">Target</th>
                <th className="p-2">Budget</th><th className="p-2">Status</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {(briefs ?? []).map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="p-2">{b.id}</td><td className="p-2">{b.source}</td>
                  <td className="p-2">{b.creator_id ?? b.deal_id ?? "-"}</td>
                  <td className="p-2">{Number(b.budget_requested ?? 0).toLocaleString("id-ID")}</td>
                  <td className="p-2">{STATUS_LABEL[b.status] ?? b.status}</td>
                  <td className="p-2">
                    {canExecute && (b.status === "baru" || b.status === "dikerjakan") && (
                      <form action={claimBrief}><input type="hidden" name="brief_id" value={b.id} />
                        <button className="text-xs text-blue-600 hover:underline">Klaim</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canInput && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Input Hasil (6 kolom manual)</h2>
          <form action={inputResult} className="grid gap-2 md:grid-cols-4">
            <input name="brief_id" type="number" placeholder="brief_id" required className="rounded border border-slate-300 p-2 text-sm" />
            <input name="period" type="date" required className="rounded border border-slate-300 p-2 text-sm" />
            <input name="ads_spent" placeholder="ads_spent (Rp)" required className="rounded border border-slate-300 p-2 text-sm" />
            <input name="gmv" placeholder="gmv (Rp)" required className="rounded border border-slate-300 p-2 text-sm" />
            <input name="cpm" placeholder="cpm" className="rounded border border-slate-300 p-2 text-sm" />
            <input name="ctr" placeholder="ctr" className="rounded border border-slate-300 p-2 text-sm" />
            <input name="cvr" placeholder="cvr" className="rounded border border-slate-300 p-2 text-sm" />
            <input name="roas" placeholder="roas" className="rounded border border-slate-300 p-2 text-sm" />
            <select name="status" className="rounded border border-slate-300 p-2 text-sm">
              <option value="draft">draft</option><option value="final">final</option>
            </select>
            <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white md:col-span-4">Simpan hasil</button>
          </form>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Hasil Campaign</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Brief</th><th className="p-2">Periode</th><th className="p-2">Ads</th>
                <th className="p-2">GMV</th><th className="p-2">ROAS</th><th className="p-2">Flag</th></tr>
            </thead>
            <tbody>
              {(results ?? []).map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2">#{r.brief_id}</td><td className="p-2">{r.period}</td>
                  <td className="p-2">{Number(r.ads_spent).toLocaleString("id-ID")}</td>
                  <td className="p-2">{Number(r.gmv).toLocaleString("id-ID")}</td>
                  <td className="p-2">{r.roas ?? "-"}</td>
                  <td className="p-2">{r.flagged ? <span className="text-red-600">⚠ review</span> : "✓"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

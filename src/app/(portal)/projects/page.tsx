import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProject } from "./actions";
import { JoinRequestPanel, type JoinRequestRow } from "./join-request-panel";

const STATUS_STYLES: Record<string, string> = {
  planning: "bg-slate-100 text-slate-600",
  aktif: "bg-green-100 text-green-800",
  selesai: "bg-blue-100 text-blue-800",
};

const rupiah = (n: number | null) =>
  n === null ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

export default async function ProjectsPage() {
  const member = await requireMember();
  const canManage = hasPermission("m7.manage", member.role);
  const canDecideJoin = hasPermission("m9.project_join_decide", member.role);

  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("special_projects")
    .select("id, name, type, start_date, end_date, target_gmv, ads_budget_cap, target_creators, status, result_summary")
    .order("start_date", { ascending: false })
    .limit(100);

  // Pending creator join requests across all projects (M9 §2.6): platform surfaces every
  // request, but the accept/reject decision is a human PM/lead call.
  let joinRequestRows: JoinRequestRow[] = [];
  if (canDecideJoin) {
    // No RLS policy grants team_members read access on project_join_requests (only
    // is_creator_user() self-read exists) — service-role client is required here.
    const admin = createAdminClient();
    const { data: pendingRequests } = await admin
      .from("project_join_requests")
      .select("id, project_id, creator_id, created_at, special_projects(name), creators(name)")
      .eq("status", "diajukan")
      .order("created_at", { ascending: true })
      .limit(100);
    joinRequestRows = (pendingRequests ?? []).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: (r.special_projects as unknown as { name: string } | null)?.name ?? `#${r.project_id}`,
      creatorId: r.creator_id,
      creatorName: (r.creators as unknown as { name: string } | null)?.name ?? r.creator_id,
      createdAt: r.created_at,
    }));
  }

  // Jumlah peserta aktual per project (vs target_creators)
  const participantCounts = new Map<number, number>();
  if ((projects ?? []).length > 0) {
    const { data: parts } = await supabase
      .from("project_participants")
      .select("project_id")
      .in("project_id", (projects ?? []).map((p) => p.id));
    for (const pt of parts ?? []) {
      participantCounts.set(pt.project_id, (participantCounts.get(pt.project_id) ?? 0) + 1);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Special Project (M7)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Manajemen project berdurasi: tracking GMV harian vs kurva target ramp-up, profitabilitas real-time
        (alert anti-rugi bila ads &gt; komisi MEA), peserta & man power. Deterministik, 0 token AI.
      </p>

      {canDecideJoin && (
        <section className="mt-6">
          <h2 className="text-lg font-medium">Pengajuan Bergabung Kreator</h2>
          <JoinRequestPanel rows={joinRequestRows} />
        </section>
      )}

      {canManage && (
        <form
          action={createProject}
          className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input name="name" required placeholder="Nama project"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="type" placeholder="Tipe (showcase/bootcamp/China trip)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Mulai
            <input type="date" name="start_date" required
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Selesai
            <input type="date" name="end_date" required
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </label>
          <input name="target_gmv" required placeholder="Target GMV (Rp)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="target_creators" type="number" min="1" placeholder="Target jumlah creator"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="ads_budget_cap" placeholder="Ads budget cap (Rp, opsional)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <select name="curve_shape" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="ramp">Kurva target: ramp-up (default)</option>
            <option value="flat">Kurva target: flat</option>
          </select>
          <button type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Buat Project
          </button>
        </form>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Periode</th>
              <th className="px-4 py-3">Target GMV</th>
              <th className="px-4 py-3">Target Creator</th>
              <th className="px-4 py-3">Ads Cap</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Achievement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(projects ?? []).map((p) => {
              const summary = p.result_summary as { achievement_pct?: number } | null;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/projects/${p.id}`} className="text-slate-900 underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                    {p.type && <span className="ml-1 text-xs text-slate-400">{p.type}</span>}
                  </td>
                  <td className="px-4 py-2">{p.start_date} → {p.end_date}</td>
                  <td className="px-4 py-2">{rupiah(p.target_gmv)}</td>
                  <td className="px-4 py-2">
                    {p.target_creators ? (
                      <span className={
                        (participantCounts.get(p.id) ?? 0) < p.target_creators
                          ? "text-amber-700" : "text-green-700"
                      }>
                        {participantCounts.get(p.id) ?? 0} / {p.target_creators}
                      </span>
                    ) : (
                      `${participantCounts.get(p.id) ?? 0}`
                    )}
                  </td>
                  <td className="px-4 py-2">{rupiah(p.ads_budget_cap)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {summary?.achievement_pct !== undefined
                      ? `${(summary.achievement_pct * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {(projects ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Belum ada project.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

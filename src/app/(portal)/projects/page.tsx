import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_TYPES } from "@/lib/m7/project-type";
import { createProject } from "./actions";
import { ProjectsTable, type ProjectRow } from "./projects-table";

export default async function ProjectsPage() {
  const member = await requireMember();
  const canManage = hasPermission("m7.manage", member.role);

  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("special_projects")
    .select("id, name, type, start_date, end_date, target_gmv, ads_budget_cap, target_creators, status, result_summary")
    .order("start_date", { ascending: false })
    .limit(100);

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

  // Baris siap-tampil untuk tabel client (search / filter status / sort / paginasi).
  const projectRows: ProjectRow[] = (projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    startDate: p.start_date,
    endDate: p.end_date,
    targetGmv: p.target_gmv,
    adsBudgetCap: p.ads_budget_cap,
    targetCreators: p.target_creators,
    participants: participantCounts.get(p.id) ?? 0,
    status: p.status,
    achievementPct: (p.result_summary as { achievement_pct?: number } | null)?.achievement_pct ?? null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Special Project (M7)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Manajemen project berdurasi: tracking GMV harian vs kurva target ramp-up, profitabilitas real-time
        (alert anti-rugi bila ads &gt; komisi MEA), peserta & man power. Deterministik, 0 token AI.
      </p>

      {canManage && (
        <form
          action={createProject}
          className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input name="name" required placeholder="Nama project"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <select name="type" required className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            {PROJECT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
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

      <ProjectsTable rows={projectRows} />
    </div>
  );
}

import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_TYPES } from "@/lib/m7/project-type";
import { ProjectCreateForm } from "./project-create-form";
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

      {canManage && <ProjectCreateForm projectTypes={PROJECT_TYPES} />}

      <ProjectsTable rows={projectRows} />
    </div>
  );
}

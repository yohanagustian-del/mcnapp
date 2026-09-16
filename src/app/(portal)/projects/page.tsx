import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROJECT_TYPES } from "@/lib/m7/project-type";
import { createProject } from "./actions";
import { JoinRequestPanel, type JoinRequestRow } from "./join-request-panel";
import { ExternalApplicantPanel, type ExternalApplicantRow } from "./external-applicant-panel";
import { ProjectsTable, type ProjectRow } from "./projects-table";

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
    // 'diundang' juga ditampilkan (tim bisa memutuskan tanpa menunggu respons
    // kreator di portal — R11/R14) di samping 'diajukan' (pendaftaran portal).
    const { data: pendingRequests } = await admin
      .from("project_join_requests")
      .select("id, project_id, creator_id, created_at, special_projects(name), creators(name)")
      .in("status", ["diajukan", "diundang"])
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

  // Pendaftar eksternal (link publik /join/{slug}) — sub-tab terpisah dari internal.
  let externalApplicantRows: ExternalApplicantRow[] = [];
  if (canDecideJoin) {
    const admin = createAdminClient();
    const { data: pendingApplicants } = await admin
      .from("project_external_applicants")
      .select("id, project_id, full_name, username, platform, followers, niche, created_at, special_projects(name)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100);
    externalApplicantRows = (pendingApplicants ?? []).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: (r.special_projects as unknown as { name: string } | null)?.name ?? `#${r.project_id}`,
      fullName: r.full_name,
      username: r.username,
      platform: r.platform,
      followers: r.followers,
      niche: r.niche,
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

      {canDecideJoin && (
        <section className="mt-6">
          <h2 className="text-lg font-medium">Pendaftar — Internal</h2>
          <p className="text-xs text-slate-500">Kreator terdaftar yang mengajukan/diundang lewat portal.</p>
          <JoinRequestPanel rows={joinRequestRows} />
        </section>
      )}

      {canDecideJoin && (
        <section className="mt-6">
          <h2 className="text-lg font-medium">Pendaftar — Eksternal</h2>
          <p className="text-xs text-slate-500">Daftar lewat link publik /join/{"{slug}"}, belum jadi kreator terdaftar.</p>
          <ExternalApplicantPanel rows={externalApplicantRows} />
        </section>
      )}

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

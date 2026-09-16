import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { setProjectRequirements, fetchShortlist } from "./requirements-actions";
import { ShortlistPanel } from "./shortlist-panel";

/** Tab Kebutuhan Kreator: set kriteria → Cari Kreator (shortlist) → Undang (§3.4). */
export default async function ProjectShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const member = await requireMember();
  const canManage = hasPermission("m7.manage", member.role);

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("special_projects").select("id, name, target_creators").eq("id", projectId).maybeSingle();
  if (!project) notFound();

  const { data: requirements } = await supabase
    .from("project_creator_requirements").select("*").eq("project_id", projectId).maybeSingle();

  const shortlist = await fetchShortlist(projectId);

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Kebutuhan Kreator — {project.name}</h1>
        <Link href={`/projects/${projectId}`} className="text-sm text-blue-700 hover:underline">← Kembali</Link>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Kriteria di bawah menyaring kandidat dari 4 periode terakhir performa kreator — deterministik, 0 token AI.
        {project.target_creators ? ` Target: ${project.target_creators} kreator.` : ""}
      </p>

      {canManage && (
        <form action={setProjectRequirements}
          className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="project_id" value={project.id} />
          <input name="niches" defaultValue={(requirements?.niches ?? []).join(", ")}
            placeholder="Niche (pisah koma, mis. Beauty, Fashion)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <select name="platform" defaultValue={requirements?.platform ?? "all"}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="all">Platform: semua</option>
            <option value="tiktok">Platform: TikTok</option>
            <option value="shopee">Platform: Shopee</option>
          </select>
          <input name="min_level" type="number" min="1" max="6" defaultValue={requirements?.min_level ?? ""}
            placeholder="Min level (1-6)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="follower_tiers" defaultValue={(requirements?.follower_tiers ?? []).join(", ")}
            placeholder="Follower tier (pisah koma)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="min_gmv_30d" defaultValue={requirements?.min_gmv_30d ?? ""}
            placeholder="Min GMV 30 hari (Rp)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="quota" type="number" min="1" defaultValue={requirements?.quota ?? ""}
            placeholder="Kuota (default = target creator)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-xs text-slate-500 sm:col-span-2 lg:col-span-1">
            <input type="checkbox" name="require_live_roster" defaultChecked={requirements?.require_live_roster ?? false} />
            Wajib live roster
          </label>
          <input name="notes" defaultValue={requirements?.notes ?? ""} placeholder="Catatan"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2 lg:col-span-2" />
          <button type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Simpan Kriteria
          </button>
        </form>
      )}

      <h2 className="mt-6 text-lg font-medium">Cari Kreator</h2>
      <ShortlistPanel projectId={projectId} rows={shortlist} />
    </div>
  );
}

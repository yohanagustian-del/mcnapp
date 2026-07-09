import { createAdminClient } from "@/lib/supabase/admin";
import { requireCreator } from "@/lib/m9/creator-auth";
import { requestJoinProject } from "../actions";

/** §2.6 — see open special projects + ask to join (PM decides, M7). Track own contribution. */
export default async function ProjectsPage() {
  const { creatorId } = await requireCreator();
  const admin = createAdminClient();

  // `planning` projects always need more creators, so they show regardless of
  // open_for_signup; `aktif` projects only show once explicitly opened for signup.
  const { data: open } = await admin
    .from("special_projects")
    .select("id, name, type, start_date, end_date, target_gmv, join_requirements, status, open_for_signup")
    .in("status", ["planning", "aktif"])
    .or("status.eq.planning,open_for_signup.eq.true");

  const { data: myReqs } = await admin
    .from("project_join_requests").select("project_id, status").eq("creator_id", creatorId);
  const reqByProject = new Map((myReqs ?? []).map((r) => [r.project_id, r.status]));

  const { data: progress } = await admin
    .from("creator_project_progress_v")
    .select("project_name, gmv_actual, target_gmv, date")
    .eq("creator_id", creatorId).order("date", { ascending: false }).limit(10);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Special Project Terbuka</h1>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(open ?? []).length === 0 && <p className="text-sm text-slate-500">Belum ada project terbuka.</p>}
          {(open ?? []).map((p) => {
            const st = reqByProject.get(p.id);
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="font-medium">
                  {p.name}
                  {p.status === "planning" && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-800">
                      Butuh kreator
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">{p.type ?? "-"} · {p.start_date} → {p.end_date}</p>
                {p.join_requirements && <p className="mt-2 text-sm">Syarat: {p.join_requirements}</p>}
                {st ? (
                  <p className="mt-2 text-xs text-slate-600">Pengajuan: {st}</p>
                ) : (
                  <form action={requestJoinProject} className="mt-2">
                    <input type="hidden" name="project_id" value={p.id} />
                    <button className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white">Ajukan ikut</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Kontribusi Saya</h2>
        <div className="mt-3 space-y-2">
          {(progress ?? []).length === 0 && <p className="text-sm text-slate-500">Belum ada kontribusi tercatat.</p>}
          {(progress ?? []).map((p, i) => (
            <div key={i} className="rounded border border-slate-200 bg-white p-3 text-sm">
              {p.project_name} · {p.date} · GMV {Number(p.gmv_actual ?? 0).toLocaleString("id-ID")}
              {p.target_gmv ? ` / target ${Number(p.target_gmv).toLocaleString("id-ID")}` : ""}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

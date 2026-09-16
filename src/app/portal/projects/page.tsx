import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCreator } from "@/lib/m9/creator-auth";
import { requestJoinProject, respondToInvite } from "../actions";

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

  // §3.7 — pending invites from the team's shortlist (R11): accept/decline here.
  const { data: invites } = await admin
    .from("project_join_requests")
    .select("id, project_id, special_projects(name)")
    .eq("creator_id", creatorId).eq("status", "diundang");

  // §3.7/PR-24: tab Info — pengumuman project yang diikuti, dengan badge belum dibaca.
  const { data: myParticipations } = await admin
    .from("project_participants")
    .select("project_id, special_projects(name)")
    .eq("creator_id", creatorId);
  const participatedProjectIds = (myParticipations ?? []).map((p) => p.project_id as number);
  let infoSections: { projectId: number; projectName: string; total: number; unread: number }[] = [];
  if (participatedProjectIds.length > 0) {
    const [{ data: announcementRows }, { data: readRows }] = await Promise.all([
      admin
        .from("project_announcements")
        .select("id, project_id")
        .in("project_id", participatedProjectIds)
        .not("published_at", "is", null)
        .lte("published_at", new Date().toISOString()),
      admin.from("project_announcement_reads").select("announcement_id").eq("creator_id", creatorId),
    ]);
    const readIds = new Set((readRows ?? []).map((r) => r.announcement_id as number));
    const byProject = new Map<number, { total: number; unread: number }>();
    for (const a of announcementRows ?? []) {
      const cur = byProject.get(a.project_id) ?? { total: 0, unread: 0 };
      cur.total += 1;
      if (!readIds.has(a.id)) cur.unread += 1;
      byProject.set(a.project_id, cur);
    }
    infoSections = (myParticipations ?? [])
      .filter((p) => byProject.has(p.project_id))
      .map((p) => ({
        projectId: p.project_id,
        projectName: (p.special_projects as unknown as { name: string } | null)?.name ?? `Project #${p.project_id}`,
        ...byProject.get(p.project_id)!,
      }));
  }

  const { data: progress } = await admin
    .from("creator_project_progress_v")
    .select("project_name, gmv_actual, target_gmv, date")
    .eq("creator_id", creatorId).order("date", { ascending: false }).limit(10);

  // Fase 1D (R28): tab Progress & Report — hanya muncul kalau tim sudah pernah
  // generate report untuk project ini (draft atau final); status='final'
  // menampilkan narasi, 'draft' hanya angka (ditegakkan di halaman report itu
  // sendiri, bukan di sini).
  const { data: myReports } = await admin
    .from("creator_reports")
    .select("project_id, status, special_projects(name)")
    .eq("creator_id", creatorId).not("project_id", "is", null)
    .in("status", ["draft", "final"]);
  const reportByProject = new Map(
    (myReports ?? []).map((r) => [
      r.project_id as number,
      { status: r.status, name: (r.special_projects as unknown as { name: string } | null)?.name },
    ])
  );

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

      {(invites ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Undangan</h2>
          <div className="mt-3 space-y-2">
            {(invites ?? []).map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <p className="font-medium">
                  {(inv.special_projects as unknown as { name: string } | null)?.name ?? `Project #${inv.project_id}`}
                </p>
                <div className="flex gap-2">
                  <form action={respondToInvite}>
                    <input type="hidden" name="request_id" value={inv.id} />
                    <input type="hidden" name="decision" value="diterima" />
                    <button className="rounded bg-green-700 px-3 py-1.5 text-xs text-white">Terima</button>
                  </form>
                  <form action={respondToInvite}>
                    <input type="hidden" name="request_id" value={inv.id} />
                    <input type="hidden" name="decision" value="ditolak" />
                    <button className="rounded bg-red-700 px-3 py-1.5 text-xs text-white">Tolak</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {infoSections.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Info</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {infoSections.map((s) => (
              <Link
                key={s.projectId} href={`/portal/projects/info/${s.projectId}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <span className="font-medium">{s.projectName}</span>
                {s.unread > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    {s.unread} belum dibaca
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {reportByProject.size > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Progress &amp; Report</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[...reportByProject.entries()].map(([projectId, r]) => (
              <Link
                key={projectId} href={`/portal/projects/report/${projectId}`}
                className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <p className="font-medium">{r.name ?? `Project #${projectId}`}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {r.status === "final" ? "Report final — lihat hasil & narasi →" : "Progress berjalan →"}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

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

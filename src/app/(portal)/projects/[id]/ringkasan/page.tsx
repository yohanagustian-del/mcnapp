import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const pct = (n: number | null | undefined) => `${(Number(n ?? 0) * 100).toFixed(0)}%`;

/**
 * Report gabungan project (PRD §6.9/§6.13 B3 — halaman, tanpa unduhan). Angka
 * datang dari `special_projects.result_summary` (ditulis oleh
 * recompute_project_summary) + leaderboard dari `project_creator_report_v` —
 * kedua sumber SUDAH dihitung; halaman ini murni menampilkan (CLAUDE.md #4).
 */
export default async function ProjectRingkasanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("special_projects")
    .select("id, name, type, start_date, end_date, target_gmv, status, result_summary, summary_computed_at")
    .eq("id", projectId).maybeSingle();
  if (!project) notFound();

  const { data: leaderboardRows } = await supabase
    .from("project_creator_report_v")
    .select("creator_id, gmv, live_share, rank, of")
    .eq("project_id", projectId)
    .order("rank")
    .limit(10);

  // Fetched separately rather than embedded on the view select: `project_creator_report_v`
  // (0057) is built from CTEs + window functions, not a plain passthrough view, so
  // PostgREST's FK-tracing for embeds isn't guaranteed to resolve through it — same
  // reason src/lib/m7/report-data.ts queries `creators` on its own instead of embedding.
  const creatorIds = (leaderboardRows ?? []).map((r) => r.creator_id);
  const { data: creatorRows } = creatorIds.length
    ? await supabase.from("creators").select("id, name, username").in("id", creatorIds)
    : { data: [] };
  const creatorById = new Map((creatorRows ?? []).map((c) => [c.id, c]));

  const summary = (project.result_summary ?? {}) as {
    achievement_pct?: number; gmv_actual?: number; live_gmv?: number; live_contribution?: number;
    participants_total?: number; participants_active?: number; sum_personal_targets?: number;
    ads_spend?: number; creator_commission?: number; mea_revenue?: number; margin?: number;
    feedback?: {
      responses?: number; avg_overall?: number; avg_materi?: number; avg_mentor?: number;
      avg_organisasi?: number; nps?: number; would_join_again_pct?: number;
    };
  };
  const fb = summary.feedback;

  return (
    <div>
      <Link href={`/projects/${projectId}`} className="text-sm text-blue-700 hover:underline">
        ← Kembali ke Project
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Report Gabungan — {project.name}</h1>
      <p className="text-sm text-slate-500">
        {project.type} · {project.start_date} → {project.end_date}
        {project.summary_computed_at && (
          <span className="ml-1 text-xs text-slate-400">
            (dihitung {new Date(project.summary_computed_at).toLocaleString("id-ID")})
          </span>
        )}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">GMV Aktual vs Target</p>
          <p className="mt-1 text-2xl font-semibold">{rupiah(summary.gmv_actual)}</p>
          <p className="text-xs text-slate-400">{pct(summary.achievement_pct)} dari target {rupiah(project.target_gmv)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Peserta</p>
          <p className="mt-1 text-2xl font-semibold">{summary.participants_active ?? 0} / {summary.participants_total ?? 0}</p>
          <p className="text-xs text-slate-400">aktif (GMV &gt; 0) dari total peserta</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Live Contribution</p>
          <p className="mt-1 text-2xl font-semibold">{pct(summary.live_contribution)}</p>
          <p className="text-xs text-slate-400">GMV live {rupiah(summary.live_gmv)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Margin</p>
          <p className={`mt-1 text-2xl font-semibold ${(summary.margin ?? 0) < 0 ? "text-red-700" : ""}`}>{rupiah(summary.margin)}</p>
          <p className="text-xs text-slate-400">
            Revenue MEA {rupiah(summary.mea_revenue)} − ads {rupiah(summary.ads_spend)}
          </p>
        </div>
      </div>

      {fb && (fb.responses ?? 0) > 0 && (
        <>
          <h2 className="mt-8 text-lg font-medium">Feedback ({fb.responses} respons)</h2>
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase text-slate-500">Rating Keseluruhan</p>
              <p className="mt-1 text-2xl font-semibold">{(fb.avg_overall ?? 0).toFixed(1)} / 5</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase text-slate-500">NPS</p>
              <p className="mt-1 text-2xl font-semibold">{Math.round((fb.nps ?? 0) * 100)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase text-slate-500">Mau Ikut Lagi</p>
              <p className="mt-1 text-2xl font-semibold">{pct(fb.would_join_again_pct)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase text-slate-500">Materi / Mentor / Acara</p>
              <p className="mt-1 text-lg font-semibold">
                {(fb.avg_materi ?? 0).toFixed(1)} / {(fb.avg_mentor ?? 0).toFixed(1)} / {(fb.avg_organisasi ?? 0).toFixed(1)}
              </p>
            </div>
          </div>
        </>
      )}

      <h2 className="mt-8 text-lg font-medium">Leaderboard (Top 10)</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Kreator</th>
              <th className="px-4 py-3">GMV</th>
              <th className="px-4 py-3">Live Share</th>
              <th className="px-4 py-3">Report</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(leaderboardRows ?? []).map((r) => {
              const c = creatorById.get(r.creator_id) ?? null;
              return (
                <tr key={r.creator_id}>
                  <td className="px-4 py-2">#{r.rank} / {r.of}</td>
                  <td className="px-4 py-2 font-medium">
                    {c?.name ?? r.creator_id}
                    {c?.username && <span className="ml-1 text-xs text-slate-400">@{c.username}</span>}
                  </td>
                  <td className="px-4 py-2">{rupiah(r.gmv)}</td>
                  <td className="px-4 py-2">{pct(r.live_share)}</td>
                  <td className="px-4 py-2">
                    <Link href={`/projects/${projectId}/report/${r.creator_id}`} className="text-blue-700 hover:underline">
                      Lihat report →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {(leaderboardRows ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Belum ada data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

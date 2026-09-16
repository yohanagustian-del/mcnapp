import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCreator } from "@/lib/m9/creator-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProjectReportView } from "@/components/project-report-view";
import { DisputeSessionButton } from "@/components/dispute-session-button";
import { ProjectFeedbackForm } from "@/components/project-feedback-form";
import type { ProjectReportData } from "@/lib/m7/report-data";

const STATUS_LABELS: Record<string, string> = {
  verified: "Terverifikasi", confirmed_manual: "Dikonfirmasi tim", disputed: "Sedang disanggah",
};

/**
 * Tab Progress & Report (portal kreator, PRD R28/Fase 1D): sebelum final,
 * angka live tanpa narasi; sesudah final, narasi ikut tampil. Peserta hanya
 * bisa membuka report miliknya — ditegakkan di sini via filter `creator_id`
 * eksplisit (isolasi utama, sama seperti halaman portal lain di repo ini),
 * dengan RLS `reports_creator_selfonly` (0011) sebagai lapis kedua.
 */
export default async function PortalProjectReportPage({
  params,
}: { params: Promise<{ projectId: string }> }) {
  const { projectId: projectIdRaw } = await params;
  const projectId = Number(projectIdRaw);
  if (!Number.isInteger(projectId)) notFound();

  const { creatorId } = await requireCreator();
  const admin = createAdminClient();

  const { data: reports } = await admin
    .from("creator_reports")
    .select("id, status, data_json, insight_draft, insight_final")
    .eq("project_id", projectId).eq("creator_id", creatorId)
    .in("status", ["draft", "final"]);

  const report = (reports ?? []).find((r) => r.status === "final") ?? (reports ?? [])[0];
  if (!report) notFound();

  const data = report.data_json as unknown as ProjectReportData;
  // R28 (LOCKED): before final, live numbers only — narrative withheld even if
  // the draft already has one, regardless of what generateProjectReports wrote.
  const insight = report.status === "final" ? (report.insight_final ?? report.insight_draft) : null;

  // §10.3/PR-26: sesi live milik kreator ini sendiri — tempat tombol "Ini bukan
  // data saya" muncul. Live query (bukan snapshot report) supaya status sanggahan
  // selalu terkini.
  const { data: sessionRows } = await admin
    .from("project_live_sessions")
    .select("id, session_date, session_no, gmv, brand, attribution_status")
    .eq("project_id", projectId).eq("creator_id", creatorId)
    .neq("attribution_status", "voided")
    .order("session_date", { ascending: false }).order("session_no", { ascending: false });

  // §3.8/R31: form feedback, terbuka saat status='selesai' atau feedback_open_at<=now(),
  // tutup di feedback_close_at.
  const { data: project } = await admin
    .from("special_projects")
    .select("status, feedback_open_at, feedback_close_at")
    .eq("id", projectId).maybeSingle();
  const now = new Date();
  const feedbackOpen = Boolean(
    project &&
      (project.status === "selesai" || (project.feedback_open_at && new Date(project.feedback_open_at) <= now)) &&
      (!project.feedback_close_at || new Date(project.feedback_close_at) >= now)
  );
  const { data: existingFeedback } = await admin
    .from("project_feedback")
    .select("rating_overall, rating_materi, rating_mentor, rating_organisasi, nps, would_join_again, best_part, improvement")
    .eq("project_id", projectId).eq("creator_id", creatorId).maybeSingle();

  return (
    <div>
      <Link href="/portal/projects" className="text-sm text-blue-700 hover:underline">← Kembali</Link>
      <div className="mt-3">
        <ProjectReportView data={data} insight={insight} status={report.status as "draft" | "final"} />
      </div>

      {(sessionRows ?? []).length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-medium">Sesi Live Saya</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Tanggal</th>
                  <th className="px-4 py-3">Sesi</th>
                  <th className="px-4 py-3">GMV</th>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(sessionRows ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2">{s.session_date}</td>
                    <td className="px-4 py-2">#{s.session_no}</td>
                    <td className="px-4 py-2">Rp{Math.round(Number(s.gmv ?? 0)).toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2">{s.brand ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{STATUS_LABELS[s.attribution_status] ?? s.attribution_status}</td>
                    <td className="px-4 py-2">
                      {s.attribution_status !== "disputed" && <DisputeSessionButton sessionId={s.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {feedbackOpen && (
        <ProjectFeedbackForm
          projectId={projectId}
          closesAt={project?.feedback_close_at ?? null}
          defaults={{
            ratingOverall: existingFeedback?.rating_overall ?? null,
            ratingMateri: existingFeedback?.rating_materi ?? null,
            ratingMentor: existingFeedback?.rating_mentor ?? null,
            ratingOrganisasi: existingFeedback?.rating_organisasi ?? null,
            nps: existingFeedback?.nps ?? null,
            wouldJoinAgain: existingFeedback?.would_join_again ?? null,
            bestPart: existingFeedback?.best_part ?? null,
            improvement: existingFeedback?.improvement ?? null,
          }}
        />
      )}
    </div>
  );
}

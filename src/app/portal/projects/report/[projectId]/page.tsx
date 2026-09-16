import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCreator } from "@/lib/m9/creator-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProjectReportView } from "@/components/project-report-view";
import type { ProjectReportData } from "@/lib/m7/report-data";

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

  return (
    <div>
      <Link href="/portal/projects" className="text-sm text-blue-700 hover:underline">← Kembali</Link>
      <div className="mt-3">
        <ProjectReportView data={data} insight={insight} status={report.status as "draft" | "final"} />
      </div>
    </div>
  );
}

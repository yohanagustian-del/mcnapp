import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { ProjectReportView } from "@/components/project-report-view";
import { finalizeProjectReport } from "../../report-actions";
import type { ProjectReportData } from "@/lib/m7/report-data";
import { PrintButton } from "@/app/(portal)/reports/[id]/print-button";

/**
 * Halaman report peserta (tim) — PRD §6.13/B3: presentasi di halaman, tanpa
 * template unduhan PNG/PDF baru. Tombol Export (Print/PDF) yang dipakai di sini
 * adalah tombol print browser yang sama dengan report kreator (reports/[id]/
 * print-button.tsx, B3: "dipakai ulang apa adanya") — bukan generator PDF baru.
 */
export default async function ProjectReportPage({
  params,
}: { params: Promise<{ id: string; creatorId: string }> }) {
  const { id, creatorId } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const member = await requireMember();
  // Dibuka untuk semua role staff (bukan cuma m7.manage) — permintaan user
  // 2026-09-28: menyunting insight report project bukan aksi berisiko yang
  // butuh dibatasi ke pengelola project saja (beda dari m7.manage yang
  // mengatur buat/edit project & man power).
  const canEditInsight = hasPermission("m7.report_insight_edit", member.role);

  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("creator_reports")
    .select("id, status, data_json, insight_draft, insight_final")
    .eq("project_id", projectId).eq("creator_id", creatorId)
    .order("status", { ascending: false }) // 'final' sorts after 'draft' alphabetically… guard below picks explicitly
    .limit(5);

  const report = (reports ?? []).find((r) => r.status === "final") ?? (reports ?? [])[0];
  if (!report) notFound();

  const data = report.data_json as unknown as ProjectReportData;
  const insight = report.status === "final" ? (report.insight_final ?? report.insight_draft) : report.insight_draft;

  return (
    <div>
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/projects/${projectId}`} className="text-sm text-blue-700 hover:underline">
          ← Kembali ke Project
        </Link>
        {report.status === "final" && <PrintButton />}
      </div>
      <div className="mt-3">
        <ProjectReportView data={data} insight={insight} status={report.status as "draft" | "final"} audience="team" />
      </div>

      {canEditInsight && (
        <form action={finalizeProjectReport} className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <input type="hidden" name="report_id" value={report.id} />
          <label className="block text-sm font-medium">
            {report.status === "final" ? "Edit insight (report sudah final)" : "Edit insight sebelum finalisasi (opsional)"}
          </label>
          <textarea
            name="insight_final" rows={5}
            defaultValue={(report.status === "final" ? report.insight_final : report.insight_draft) ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            {report.status === "final" ? "Simpan & Final Lagi" : "Finalkan Report"}
          </button>
        </form>
      )}
    </div>
  );
}

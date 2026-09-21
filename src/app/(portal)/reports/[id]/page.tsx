import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CreatorReportView } from "@/components/creator-report-view";
import { isReportV2, type ReportDataV2, type ReportEdits } from "@/lib/report/types";
import { FinalizeForm } from "./finalize-form";
import { PrintButton } from "./print-button";
import { LegacyReportView, type LegacyReportRow } from "./legacy-report-view";

/**
 * Halaman report kreator (tim). Satu URL, tiga bentuk isi:
 *  - `schema_version: 2` → `CreatorReportView` (report v2, rule-based, 0 token).
 *  - report lama tanpa `schema_version` → tampilan v1 apa adanya (tetap terbaca).
 *  - report milik project / slot Jadwal Live → dialihkan ke halamannya sendiri,
 *    karena bentuk datanya `ProjectReportData`, bukan report periode kreator.
 */
export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  if (!hasPermission("reports.generate", member.role)) redirect("/dashboard");
  const { id } = await params;

  const supabase = await createClient();
  const { data: report } = await supabase
    .from("creator_reports")
    .select("id, creator_id, period_type, period_start, data_json, edits_json, insight_draft, insight_final, status, token_used, generated_at, project_id, schedule_slot_id")
    .eq("id", Number(id))
    .maybeSingle();
  if (!report) notFound();

  if (report.period_type === "project" && report.project_id) {
    redirect(`/projects/${report.project_id}/report/${report.creator_id}`);
  }
  if (report.period_type === "live_session" && report.schedule_slot_id) {
    redirect(`/schedule/live/${report.schedule_slot_id}/report`);
  }

  const canFinalize = hasPermission("reports.finalize", member.role) && report.status === "draft";

  if (!isReportV2(report.data_json)) {
    return <LegacyReportView report={report as unknown as LegacyReportRow} canFinalize={canFinalize} />;
  }

  const data = report.data_json as unknown as ReportDataV2;
  const edits = (report.edits_json as ReportEdits | null) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between print:hidden">
        <Link href="/reports" className="text-sm text-slate-500 underline">← Kembali ke daftar</Link>
        {report.status === "final" && <PrintButton />}
      </div>

      <div className="mt-3">
        <CreatorReportView
          data={data}
          edits={edits}
          status={report.status as "draft" | "final"}
          editable={canFinalize}
          audience="team"
          reportId={report.id}
        />
      </div>

      {canFinalize && (
        <div className="mx-auto mt-4 max-w-4xl rounded-lg border border-slate-200 bg-white p-4 print:hidden">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Finalisasi</h2>
          <p className="mt-1 text-xs text-slate-400">
            Setelah final, teks report terkunci dan kreator bisa membacanya di portal. Suntingan teks
            dilakukan lewat tombol &ldquo;Edit Report&rdquo; di atas.
          </p>
          <div className="mt-2">
            <FinalizeForm reportId={report.id} insightDraft={report.insight_draft} />
          </div>
        </div>
      )}
    </div>
  );
}

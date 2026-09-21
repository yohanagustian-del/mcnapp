import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCreator } from "@/lib/m9/creator-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CreatorReportView } from "@/components/creator-report-view";
import { ProjectReportView } from "@/components/project-report-view";
import { isReportV2, type ReportDataV2 } from "@/lib/report/types";
import type { ProjectReportData } from "@/lib/m7/report-data";

/**
 * Report yang dikirim CPM, DIBACA UTUH oleh kreator (keputusan user 2026-09-21).
 * Sebelum ini `/portal/reports` hanya mendaftar judulnya tanpa bisa dibuka —
 * report yang "sudah dikirim ke kreator" tidak pernah benar-benar bisa dibaca.
 *
 * Isolasi: filter `creator_id` eksplisit (lapis utama, sama seperti halaman
 * portal lain di repo ini) + RLS `reports_creator_selfonly` (0011) sebagai
 * lapis kedua. HANYA report berstatus final yang dibuka — draft masih milik tim.
 */
export default async function PortalReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) notFound();

  const { creatorId } = await requireCreator();
  const admin = createAdminClient();

  const { data: report } = await admin
    .from("creator_reports")
    .select("id, creator_id, period_type, period_start, status, data_json, insight_draft, insight_final")
    .eq("id", reportId)
    .eq("creator_id", creatorId)
    .eq("status", "final")
    .maybeSingle();
  if (!report) notFound();

  const insight = report.insight_final ?? report.insight_draft;

  return (
    <div>
      <Link href="/portal/reports" className="text-sm text-blue-700 hover:underline print:hidden">
        ← Kembali ke daftar report
      </Link>
      <div className="mt-3">
        {isReportV2(report.data_json) ? (
          <CreatorReportView
            data={report.data_json as unknown as ReportDataV2}
            edits={null}
            status="final"
            editable={false}
            audience="creator"
            reportId={report.id}
          />
        ) : report.period_type === "live_session" || report.period_type === "project" ? (
          <ProjectReportView
            data={report.data_json as unknown as ProjectReportData}
            insight={insight}
            status="final"
          />
        ) : (
          // Report versi lama (sebelum schema_version 2): tampilkan narasinya apa
          // adanya — tabel metrik v1 memakai istilah internal yang tidak cocok
          // untuk kreator, dan report ini tidak akan bertambah lagi.
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h1 className="text-lg font-semibold">
              Report {report.period_type} · {report.period_start}
            </h1>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
              {insight ?? "Report ini tidak memuat catatan tertulis."}
            </p>
            <p className="mt-4 text-xs text-slate-400">
              Report versi lama. Minta CPM Anda men-generate ulang untuk melihat rincian lengkap
              (produk, live, rekomendasi).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

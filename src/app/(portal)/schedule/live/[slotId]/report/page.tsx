import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { ProjectReportView } from "@/components/project-report-view";
import type { ProjectReportData } from "@/lib/m7/report-data";
import { SlotFinalizeForm } from "./slot-finalize-form";

export const dynamic = "force-dynamic";

/**
 * Report live stream satu slot Jadwal Live (tim). Memakai komponen report yang
 * SAMA dengan report peserta Special Project — bentuk `data_json`-nya memang
 * satu kontrak (`ProjectReportData`, `period.type = live_slot`).
 */
export default async function SlotLiveReportPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId: slotIdRaw } = await params;
  const slotId = Number(slotIdRaw);
  if (!Number.isInteger(slotId)) notFound();

  const member = await requireMember();
  if (!hasPermission("schedule.view", member.role)) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Akses ditolak — role Anda tidak memiliki izin melihat Jadwal Live.
      </div>
    );
  }

  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("creator_reports")
    .select("id, status, data_json, insight_draft, insight_final, creator_id, creators(owner_cpm_id)")
    .eq("schedule_slot_id", slotId)
    .in("status", ["draft", "final"]);

  const report = (reports ?? []).find((r) => r.status === "final") ?? (reports ?? [])[0];
  if (!report) notFound();

  const ownerCpmId = (report.creators as unknown as { owner_cpm_id: string | null } | null)?.owner_cpm_id ?? null;
  if (member.role === "cpm" && ownerCpmId !== member.id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Akses ditolak — CPM hanya bisa membuka report kreator yang dipegangnya.
      </div>
    );
  }

  const data = report.data_json as unknown as ProjectReportData;
  const insight = report.status === "final" ? (report.insight_final ?? report.insight_draft) : report.insight_draft;
  const canFinalize = hasPermission("reports.finalize", member.role) && report.status === "draft";

  return (
    <div>
      <Link href={`/schedule/live/${slotId}`} className="text-sm text-blue-700 hover:underline print:hidden">
        ← Kembali ke data live slot
      </Link>
      <div className="mt-3">
        <ProjectReportView data={data} insight={insight} status={report.status as "draft" | "final"} audience="team" />
      </div>
      {canFinalize && <SlotFinalizeForm reportId={report.id as number} insightDraft={report.insight_draft} />}
    </div>
  );
}

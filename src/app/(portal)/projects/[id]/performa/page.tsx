import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { canUploadProjectPerformance, isAssignedManpower } from "@/lib/m7/access";
import { createClient } from "@/lib/supabase/server";
import { LiveUploadForm, type ParticipantOption } from "./live-upload-form";
import { LiveSessionHistoryTable, type LiveSessionHistoryRow } from "./live-session-history-table";
import { DisputeResolutionPanel, type DisputedSessionRow, type ReassignTargetOption } from "./dispute-resolution-panel";

/** Tab Performa (M7 v2 Fase 1A, §3.1/§10.2): upload sesi live berkonteks kreator. */
export default async function ProjectPerformaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const member = await requireMember();
  const supabase = await createClient();

  // Man power in-charge project ini boleh mengunggah performanya walau role
  // globalnya tidak punya m7.metrics (M7 §2.5 — aturannya di lib/m7/access,
  // ditegakkan ulang di server action, bukan hanya di sini).
  const hasMetrics = hasPermission("m7.metrics", member.role);
  const canUpload = canUploadProjectPerformance({
    hasMetricsPermission: hasMetrics,
    isAssignedManpower: hasMetrics ? false : await isAssignedManpower(supabase, projectId, member.id),
  });
  const { data: project } = await supabase
    .from("special_projects")
    .select("id, name, start_date, end_date")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const { data: participantRows } = await supabase
    .from("project_participants")
    .select("creator_id, creators(name, username, level)")
    .eq("project_id", projectId);

  const { data: sessionCountRows } = await supabase
    .from("project_live_sessions")
    .select("creator_id")
    .eq("project_id", projectId)
    .neq("attribution_status", "voided");
  const sessionCounts = new Map<string, number>();
  for (const r of sessionCountRows ?? []) {
    sessionCounts.set(r.creator_id, (sessionCounts.get(r.creator_id) ?? 0) + 1);
  }

  const participants: ParticipantOption[] = (participantRows ?? [])
    .map((p) => {
      const c = p.creators as unknown as { name: string; username: string | null; level: number | null } | null;
      return {
        creatorId: p.creator_id,
        name: c?.name ?? p.creator_id,
        username: c?.username ?? null,
        level: c?.level ?? null,
        sessionsRecorded: sessionCounts.get(p.creator_id) ?? 0,
      };
    })
    .filter((p) => Boolean(p.username));

  const { data: historyRows } = await supabase
    .from("project_live_sessions")
    .select(
      "id, creator_id, session_date, session_no, gmv, gmv_trend, orders, attribution_status, filename_product, filename_trend, creators(name, username)"
    )
    .eq("project_id", projectId)
    .order("session_date", { ascending: false })
    .order("session_no", { ascending: false })
    .limit(200);

  const history: LiveSessionHistoryRow[] = (historyRows ?? []).map((r) => {
    const c = r.creators as unknown as { name: string; username: string | null } | null;
    return {
      id: r.id,
      creatorName: c?.name ?? r.creator_id,
      creatorUsername: c?.username ?? null,
      sessionDate: r.session_date,
      sessionNo: r.session_no,
      gmv: Number(r.gmv ?? 0),
      gmvTrend: r.gmv_trend === null ? null : Number(r.gmv_trend),
      orders: r.orders ?? 0,
      attributionStatus: r.attribution_status,
      filenameProduct: r.filename_product,
      filenameTrend: r.filename_trend,
    };
  });

  // §10.3/PR-26: sesi disanggah kreator, menunggu resolusi tim.
  const { data: disputedRows } = canUpload
    ? await supabase
        .from("project_live_sessions")
        .select("id, creator_id, session_date, session_no, gmv, brand, dispute_reason, disputed_at, creators(name)")
        .eq("project_id", projectId).eq("attribution_status", "disputed")
        .order("disputed_at", { ascending: true })
    : { data: null };
  const disputed: DisputedSessionRow[] = (disputedRows ?? []).map((r) => ({
    id: r.id, creatorId: r.creator_id,
    creatorName: (r.creators as unknown as { name: string } | null)?.name ?? r.creator_id,
    sessionDate: r.session_date, sessionNo: r.session_no, gmv: Number(r.gmv ?? 0),
    brand: r.brand, disputeReason: r.dispute_reason, disputedAt: r.disputed_at,
  }));
  const reassignTargets: ReassignTargetOption[] = participants.map((p) => ({ creatorId: p.creatorId, name: p.name }));

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Performa — {project.name}</h1>
        <Link href={`/projects/${projectId}`} className="text-sm text-blue-700 hover:underline">
          ← Kembali ke Project
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Upload sesi live TikTok (per kreator). GMV project sepenuhnya dari upload — tidak ada input manual.
      </p>

      {canUpload ? (
        <LiveUploadForm projectId={projectId} participants={participants} />
      ) : (
        <p className="mt-6 text-sm text-red-700">Role Anda tidak punya izin mengunggah performa project.</p>
      )}

      {canUpload && <DisputeResolutionPanel rows={disputed} targets={reassignTargets} />}

      <h2 className="mt-8 text-lg font-medium">Riwayat Sesi</h2>
      <LiveSessionHistoryTable rows={history} canManage={canUpload} />
    </div>
  );
}

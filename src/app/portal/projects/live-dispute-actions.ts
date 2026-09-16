"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requireCreator, creatorActor } from "@/lib/m9/creator-auth";

/**
 * "Ini bukan data saya" (PRD §10.3/PR-26) — creator disputes a live session
 * attributed to them. Immediately pulls the session out of the roll-up
 * (attribution_status='disputed' — `project_creator_daily_live_v` filters to
 * verified/confirmed_manual only, CLAUDE.md #4) pending team resolution.
 * Auto (not approval-gated): a self-correction claim, resolved afterward by
 * the team via reassignLiveSession/rejectLiveSessionDispute.
 */
export async function disputeLiveSession(formData: FormData): Promise<void> {
  const { creatorId } = await requireCreator();
  const sessionId = Number(formData.get("session_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!sessionId) throw new Error("Sesi tidak valid");
  if (!reason) throw new Error("Alasan sanggahan wajib diisi");

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("project_live_sessions")
    .select("id, project_id, creator_id, session_date, attribution_status")
    .eq("id", sessionId).eq("creator_id", creatorId).maybeSingle();
  if (!session) throw new Error("Sesi tidak ditemukan");
  if (!["verified", "confirmed_manual"].includes(session.attribution_status)) {
    throw new Error("Sesi ini tidak bisa disanggah dari statusnya saat ini");
  }

  const { error } = await admin
    .from("project_live_sessions")
    .update({
      attribution_status: "disputed", disputed_at: new Date().toISOString(),
      dispute_reason: reason, updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);

  await writeAudit({
    actorLabel: creatorActor(creatorId), action: "m7.live_session_dispute",
    entityType: "project_live_sessions", entityId: String(sessionId),
    before: { attribution_status: session.attribution_status },
    after: { attribution_status: "disputed", dispute_reason: reason }, type: "auto",
  });

  await admin.rpc("recompute_creator_daily_live", {
    p: session.project_id, c: creatorId, d: session.session_date,
  });
  await admin.rpc("recompute_project_daily", { p: session.project_id });
  await admin.rpc("recompute_project_summary", { p: session.project_id });

  revalidatePath(`/portal/projects/report/${session.project_id}`);
}

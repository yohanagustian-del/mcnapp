"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requireCreator, creatorActor } from "@/lib/m9/creator-auth";
import { weekStart, hasReportCredit } from "@/lib/m9/portal";

/**
 * M9 creator intake actions. Every write:
 *   - resolves the creator from the session (never trusts a client-supplied creator_id),
 *   - uses the service-role client with creator_id pinned to the session,
 *   - records audit_logs with actor_label 'creator_user:CRT-xxxxx'.
 * These are requests/intake — never direct writes to operational tables (§2, LOCKED).
 */

/** §2.7 — file a complaint. target_cpm_id auto-resolved from the creator's owner CPM. */
export async function submitComplaint(formData: FormData): Promise<void> {
  const { creatorId } = await requireCreator();
  const category = String(formData.get("category") ?? "").trim();
  const severity = String(formData.get("severity") ?? "sedang");
  const body = String(formData.get("body") ?? "").trim();
  if (!category || !body) throw new Error("Kategori dan isi komplain wajib diisi");
  if (!["rendah", "sedang", "tinggi"].includes(severity)) throw new Error("Severity tidak valid");

  const admin = createAdminClient();
  const { data: creator } = await admin.from("creators").select("owner_cpm_id").eq("id", creatorId).maybeSingle();

  const { data: row, error } = await admin
    .from("creator_complaints")
    .insert({ creator_id: creatorId, category, severity, body, target_cpm_id: creator?.owner_cpm_id ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAudit({
    actorLabel: creatorActor(creatorId), action: "m9.complaint_submit",
    entityType: "creator_complaints", entityId: String(row.id),
    after: { category, severity, status: "baru" }, type: "auto",
  });
  revalidatePath("/portal/complaints");
}

/** §2.7 — non-complaint feedback (never scored negative). */
export async function submitFeedback(formData: FormData): Promise<void> {
  const { creatorId } = await requireCreator();
  const body = String(formData.get("body") ?? "").trim();
  const sentiment = String(formData.get("sentiment") ?? "netral");
  if (!body) throw new Error("Isi feedback wajib diisi");
  const admin = createAdminClient();
  const { error } = await admin.from("creator_feedback").insert({ creator_id: creatorId, body, sentiment });
  if (error) throw new Error(error.message);
  await writeAudit({
    actorLabel: creatorActor(creatorId), action: "m9.feedback_submit",
    entityType: "creator_feedback", after: { sentiment }, type: "auto",
  });
  revalidatePath("/portal/complaints");
}

/** §2.5 — brand/ads/sample request → routed to owner CPM as source=creator_portal. */
export async function submitRequest(formData: FormData): Promise<void> {
  const { creatorId } = await requireCreator();
  const type = String(formData.get("type") ?? "");
  const targetBrand = String(formData.get("target_brand") ?? "").trim();
  const amount = formData.get("amount") ? Number(formData.get("amount")) : null;
  if (!["sample", "ads", "hsl"].includes(type)) throw new Error("Jenis request tidak valid");

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("creator_requests")
    .insert({ creator_id: creatorId, type, target_brand: targetBrand || null, amount, source: "creator_portal" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await writeAudit({
    actorLabel: creatorActor(creatorId), action: "m9.request_submit",
    entityType: "creator_requests", entityId: String(row.id),
    after: { type, target_brand: targetBrand, source: "creator_portal" }, type: "auto",
  });
  revalidatePath("/portal/requests");
}

/** §2.6 — ask to join an open special project (candidate only; PM decides — M7). */
export async function requestJoinProject(formData: FormData): Promise<void> {
  const { creatorId } = await requireCreator();
  const projectId = Number(formData.get("project_id"));
  if (!Number.isFinite(projectId)) throw new Error("Project tidak valid");

  const admin = createAdminClient();
  // `planning` projects are always short on creators, so they may always be joined;
  // `aktif` projects require the PM to have explicitly opened them for signup.
  const { data: proj } = await admin
    .from("special_projects").select("id, status, open_for_signup").eq("id", projectId).maybeSingle();
  if (!proj || !["planning", "aktif"].includes(proj.status)) {
    throw new Error("Project tidak ditemukan");
  }
  if (proj.status === "aktif" && !proj.open_for_signup) {
    throw new Error("Project tidak terbuka untuk pendaftaran");
  }

  const { error } = await admin
    .from("project_join_requests")
    .insert({ project_id: projectId, creator_id: creatorId });
  if (error) throw new Error(error.message.includes("duplicate") ? "Kamu sudah mengajukan project ini" : error.message);
  await writeAudit({
    actorLabel: creatorActor(creatorId), action: "m9.project_join",
    entityType: "project_join_requests", entityId: String(projectId), type: "auto",
  });
  revalidatePath("/portal/projects");
}

/**
 * §2.3 — spend this week's report-improvement credit (1/creator/week, no accumulation).
 * The unique(creator_id, week_start) constraint is the hard guard; this pre-checks for a
 * friendly error. The actual LLM insight reuses the M2 pipeline (generated_by=creator_self)
 * and is invoked by the caller only after this returns the reserved week.
 */
export async function useReportCredit(): Promise<{ weekStart: string }> {
  const { creatorId } = await requireCreator();
  const admin = createAdminClient();
  const now = new Date();
  const wk = weekStart(now);

  const { data: used } = await admin
    .from("creator_report_credits").select("week_start").eq("creator_id", creatorId);
  if (!hasReportCredit(now, (used ?? []).map((u) => u.week_start as string))) {
    throw new Error("Kredit report minggu ini sudah dipakai — tersedia lagi Senin depan");
  }

  const { error } = await admin
    .from("creator_report_credits").insert({ creator_id: creatorId, week_start: wk });
  // Race: unique violation means someone/something already claimed it this week.
  if (error) throw new Error("Kredit report minggu ini sudah dipakai");

  await writeAudit({
    actorLabel: creatorActor(creatorId), action: "m9.report_credit_use",
    entityType: "creator_report_credits", entityId: wk, type: "auto",
  });
  return { weekStart: wk };
}

/**
 * §2.3 form wrapper — spend the weekly credit, then generate the self-service improvement
 * report. The insight itself reuses the M2 pipeline (generated_by=creator_self, input = ready
 * numbers, token logged to the M2 ratchet); wiring that call is the only LLM in M9 and is left
 * as the documented integration point. The quota guard (1/week, no bypass) is enforced above.
 */
export async function generateSelfReport(): Promise<void> {
  await useReportCredit();
  revalidatePath("/portal/reports");
}

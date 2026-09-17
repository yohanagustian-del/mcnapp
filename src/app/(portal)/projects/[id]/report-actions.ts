"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { buildProjectReportData } from "@/lib/m7/report-data";
import { generateInsight, insightAvailable } from "@/lib/report/insight";

/**
 * Generate/refresh ONE participant's project report draft (PRD §3.3/§6.8, PR-15).
 * R26: at most one active draft per (project, creator) — regenerating REPLACES
 * its content in place (same effect as "draft lama diarsip, draft baru dibuat"
 * without needing a delete+insert dance around the partial unique index that
 * enforces it; `creator_reports_project_draft_key` still guards against a
 * second concurrent draft ever existing). R29: creators with zero activity
 * still get a report (data comes back zeroed from buildProjectReportData).
 */
async function generateOneProjectReport(
  admin: ReturnType<typeof createAdminClient>,
  projectId: number,
  creatorId: string,
  actorId: string
): Promise<number> {
  const dataJson = await buildProjectReportData(admin, projectId, creatorId);
  const generatedAt = new Date().toISOString();

  const { data: existingRows } = await admin
    .from("creator_reports")
    .select("id, status")
    .eq("project_id", projectId).eq("creator_id", creatorId)
    .in("status", ["draft", "final"]);
  const existingDraft = (existingRows ?? []).find((r) => r.status === "draft") ?? null;
  const existingFinal = (existingRows ?? []).find((r) => r.status === "final") ?? null;

  // Baris `final` adalah yang BENAR-BENAR dilihat tim maupun kreator (kedua
  // halaman report memilih final lebih dulu). Sebelum ini generate hanya
  // menulis ke draft, jadi report yang sudah difinalkan tidak pernah berubah
  // walau sesi baru diupload — tim menekan Generate berkali-kali dan layarnya
  // tetap memperlihatkan angka lama (temuan QA produksi 2026-09-17, project
  // #12: final berisi 15 Sep saja padahal sesi 16 Sep sudah masuk).
  //
  // Angkanya disegarkan; narasi final milik tim (`insight_final`) dan
  // statusnya tidak disentuh — finalisasi mengatur narasi (R28), bukan
  // membekukan angka.
  if (existingFinal) {
    const { error } = await admin
      .from("creator_reports")
      .update({ data_json: dataJson, generated_by: actorId, generated_at: generatedAt })
      .eq("id", existingFinal.id);
    if (error) throw new Error(`Gagal memperbarui report final: ${error.message}`);
    await writeAudit({
      actorId, action: "m7.report_generate", entityType: "creator_reports",
      entityId: String(existingFinal.id),
      after: { project_id: projectId, creator_id: creatorId, token_used: 0, refreshed_final: true },
      type: "auto",
    });
    // Tanpa draft yang sedang disiapkan, tidak ada lagi yang perlu ditulis —
    // dan tidak ada alasan memanggil LLM untuk narasi yang tak akan tampil.
    if (!existingDraft) return 0;
  }

  let insightDraft: string | null = null;
  let tokenUsed = 0;
  if (insightAvailable()) {
    // LLM failure must not lose the deterministic report — degrade to data-only.
    try {
      const result = await generateInsight(dataJson as unknown as Record<string, unknown>, "project");
      insightDraft = result.text;
      tokenUsed = result.tokensUsed;
    } catch {
      insightDraft = null;
    }
  }

  let reportId: number;
  if (existingDraft) {
    const { error } = await admin
      .from("creator_reports")
      .update({
        data_json: dataJson, insight_draft: insightDraft, token_used: tokenUsed,
        generated_by: actorId, generated_at: generatedAt,
      })
      .eq("id", existingDraft.id);
    if (error) throw new Error(`Gagal memperbarui draft: ${error.message}`);
    reportId = existingDraft.id;
  } else {
    const { data: inserted, error } = await admin
      .from("creator_reports")
      .insert({
        creator_id: creatorId, project_id: projectId, period_type: "project",
        period_start: dataJson.period.start, data_json: dataJson,
        insight_draft: insightDraft, status: "draft", token_used: tokenUsed, generated_by: actorId,
      })
      .select("id").single();
    if (error) throw new Error(`Gagal membuat draft: ${error.message}`);
    reportId = inserted.id;
  }

  await writeAudit({
    actorId, action: "m7.report_generate", entityType: "creator_reports", entityId: String(reportId),
    after: { project_id: projectId, creator_id: creatorId, token_used: tokenUsed, has_insight: insightDraft !== null },
    type: "auto",
  });
  return tokenUsed;
}

/** Generate massal — semua peserta, atau daftar creator_ids yang dipilih (§3.3). */
export async function generateProjectReports(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  if (!projectId) throw new Error("Project tidak valid");

  const admin = createAdminClient();
  const { data: project } = await admin.from("special_projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) throw new Error("Project tidak ditemukan");

  let targetCreatorIds = formData.getAll("creator_ids").map(String).filter(Boolean);
  if (targetCreatorIds.length === 0) {
    const { data: participants } = await admin
      .from("project_participants").select("creator_id").eq("project_id", projectId);
    targetCreatorIds = (participants ?? []).map((p) => p.creator_id);
  }
  if (targetCreatorIds.length === 0) throw new Error("Project ini belum punya peserta");

  // One participant's failure (e.g. a transient LLM/network error) must not
  // abort the rest of the batch — each report is independent.
  for (const creatorId of targetCreatorIds) {
    try {
      await generateOneProjectReport(admin, projectId, creatorId, actor.id);
    } catch {
      // swallowed — this creator's report simply doesn't get a draft this run.
    }
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/ringkasan`);
}

/**
 * Finalize (PR-15/R26): hanya satu FINAL per (project, creator) — final
 * sebelumnya (kalau ada, dari generate-ulang setelah sempat difinalkan)
 * dihapus dulu supaya index unique partial-nya tidak bentrok.
 */
export async function finalizeProjectReport(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const reportId = Number(formData.get("report_id"));
  const insightFinal = String(formData.get("insight_final") ?? "").trim();
  if (!reportId) throw new Error("Report tidak valid");

  const admin = createAdminClient();
  const { data: report } = await admin
    .from("creator_reports")
    .select("id, project_id, creator_id, status, insight_draft")
    .eq("id", reportId).maybeSingle();
  if (!report) throw new Error("Report tidak ditemukan");
  if (!report.project_id) throw new Error("Report ini bukan report project");
  if (report.status === "final") throw new Error("Report sudah final");

  const { data: previousFinal } = await admin
    .from("creator_reports").select("id")
    .eq("project_id", report.project_id).eq("creator_id", report.creator_id).eq("status", "final")
    .maybeSingle();
  if (previousFinal) {
    await admin.from("creator_reports").delete().eq("id", previousFinal.id);
  }

  const { error } = await admin
    .from("creator_reports")
    .update({ status: "final", insight_final: insightFinal || report.insight_draft, finalized_by: actor.id })
    .eq("id", reportId);
  if (error) throw new Error(`Gagal finalisasi: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.report_finalize", entityType: "creator_reports", entityId: String(reportId),
    before: { status: report.status },
    after: { status: "final", replaced_previous_final: Boolean(previousFinal) },
    type: "auto",
  });

  revalidatePath(`/projects/${report.project_id}`);
  revalidatePath(`/projects/${report.project_id}/report/${report.creator_id}`);
}

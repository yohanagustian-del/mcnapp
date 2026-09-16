"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requireCreator, creatorActor } from "@/lib/m9/creator-auth";
import { getConfig } from "@/lib/config";
import { classifyFeedbackSentiment, type SentimentLexicon } from "@/lib/m7/feedback-sentiment";

/**
 * Feedback project (PRD §3.8/§6.11, PR-25). R31: window = status='selesai' OR
 * feedback_open_at<=now(), tutup di feedback_close_at. R32: satu per (project,
 * creator), boleh diedit sampai tutup — upsert, bukan insert-only.
 * Sentiment ditulis oleh `classifyFeedbackSentiment` (rule-based, nol LLM,
 * CLAUDE.md #1) — `insight.ts` TIDAK diimpor di sini.
 */
export async function submitProjectFeedback(formData: FormData): Promise<void> {
  const { creatorId } = await requireCreator();
  const projectId = Number(formData.get("project_id"));
  if (!projectId) throw new Error("Project tidak valid");

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("special_projects")
    .select("id, status, feedback_open_at, feedback_close_at")
    .eq("id", projectId).maybeSingle();
  if (!project) throw new Error("Project tidak ditemukan");

  const now = new Date();
  const opensOk = project.status === "selesai" || (Boolean(project.feedback_open_at) && new Date(project.feedback_open_at!) <= now);
  const closesOk = !project.feedback_close_at || new Date(project.feedback_close_at) >= now;
  if (!opensOk || !closesOk) throw new Error("Jendela feedback untuk project ini sedang tidak terbuka");

  const ratings = {
    rating_overall: Number(formData.get("rating_overall")),
    rating_materi: Number(formData.get("rating_materi")),
    rating_mentor: Number(formData.get("rating_mentor")),
    rating_organisasi: Number(formData.get("rating_organisasi")),
  };
  for (const [key, v] of Object.entries(ratings)) {
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`Nilai ${key.replace("_", " ")} wajib 1-5`);
  }
  const nps = Number(formData.get("nps"));
  if (!Number.isInteger(nps) || nps < 0 || nps > 10) throw new Error("NPS wajib 0-10");
  const wouldJoinAgain = formData.get("would_join_again") === "on";
  const bestPart = String(formData.get("best_part") ?? "").trim() || null;
  const improvement = String(formData.get("improvement") ?? "").trim() || null;

  const lexicon = await getConfig<SentimentLexicon>("m7.sentiment_rules");
  const { sentiment } = classifyFeedbackSentiment({
    ratingOverall: ratings.rating_overall, nps, bestPart, improvement, lexicon,
  });

  const { data: upserted, error } = await admin.from("project_feedback").upsert(
    {
      project_id: projectId, creator_id: creatorId, ...ratings, nps,
      would_join_again: wouldJoinAgain, best_part: bestPart, improvement, sentiment,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id,creator_id" }
  ).select("id").single();
  if (error) throw new Error(error.message);

  await writeAudit({
    actorLabel: creatorActor(creatorId), action: "m7.feedback_submit", entityType: "project_feedback",
    entityId: String(upserted.id), after: { project_id: projectId, sentiment }, type: "auto",
  });

  // §6.9: aggregate feedback lives in result_summary, recomputed alongside every other number.
  await admin.rpc("recompute_project_summary", { p: projectId });

  revalidatePath(`/portal/projects/report/${projectId}`);
  revalidatePath(`/projects/${projectId}/ringkasan`);
}

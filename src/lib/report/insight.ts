import Anthropic from "@anthropic-ai/sdk";

/**
 * M2 Insight layer — the ONLY LLM call path in the report pipeline (CLAUDE.md #1).
 * Input is a compact, pre-computed JSON summary (never raw rows); one call per
 * report; token_used is returned so the caller can log it and feed the ratchet.
 *
 * Model: PRD M2 §5 locks "model reasoning ringan cukup" (light reasoning model),
 * consistent with the token-efficiency principle — default claude-haiku-4-5,
 * overridable via M2_INSIGHT_MODEL.
 */
const DEFAULT_MODEL = "claude-haiku-4-5";

export interface InsightResult {
  text: string;
  tokensUsed: number;
}

export function insightAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type InsightVariant = "weekly_monthly" | "project";

const SYSTEM_PROMPTS: Record<InsightVariant, string> = {
  weekly_monthly:
    "Kamu analis performa creator TikTok/Shopee untuk agency MCN MEA. " +
    "Input adalah ringkasan angka yang SUDAH dihitung (bukan data mentah). " +
    "Tulis dalam Bahasa Indonesia: (1) ringkasan naratif singkat kenapa angka bergerak, " +
    "(2) 3-5 rekomendasi actionable, (3) highlight peluang naik level bila relevan. " +
    "Jangan mengarang angka yang tidak ada di input. Maksimal ±250 kata.",
  // M7 v2 §6.8 PR-15: 3 paragraf pendek — pencapaian vs target pribadi & cohort,
  // apa yang bekerja (live/video/produk), 1-2 saran konkret.
  project:
    "Kamu analis performa peserta Special Project (bootcamp/training/event/showcase/campaign/trip) " +
    "untuk agency MCN MEA. Input adalah ringkasan angka project yang SUDAH dihitung (bukan data mentah), " +
    "termasuk pencapaian vs target pribadi, perbandingan dengan rata-rata peserta lain (cohort_avg), dan " +
    "produk terlaris. Tulis dalam Bahasa Indonesia, TEPAT 3 paragraf pendek: " +
    "(1) pencapaian terhadap target pribadi & posisi dibanding cohort, " +
    "(2) apa yang bekerja (kontribusi live vs video, produk terlaris), " +
    "(3) 1-2 saran konkret untuk sisa periode project. " +
    "Jangan pernah menyebut angka yang tidak ada di input. Maksimal ±200 kata.",
};

export async function generateInsight(
  summary: Record<string, unknown>,
  variant: InsightVariant = "weekly_monthly"
): Promise<InsightResult> {
  if (!insightAvailable()) {
    throw new Error("ANTHROPIC_API_KEY belum di-set — report tersimpan data-only");
  }
  const client = new Anthropic();

  const response = await client.messages.create({
    model: process.env.M2_INSIGHT_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPTS[variant],
    messages: [{ role: "user", content: JSON.stringify(summary) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return {
    text,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

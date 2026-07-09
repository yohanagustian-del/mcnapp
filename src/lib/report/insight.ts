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

export async function generateInsight(
  summary: Record<string, unknown>
): Promise<InsightResult> {
  if (!insightAvailable()) {
    throw new Error("ANTHROPIC_API_KEY belum di-set — report tersimpan data-only");
  }
  const client = new Anthropic();

  const response = await client.messages.create({
    model: process.env.M2_INSIGHT_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system:
      "Kamu analis performa creator TikTok/Shopee untuk agency MCN MEA. " +
      "Input adalah ringkasan angka yang SUDAH dihitung (bukan data mentah). " +
      "Tulis dalam Bahasa Indonesia: (1) ringkasan naratif singkat kenapa angka bergerak, " +
      "(2) 3-5 rekomendasi actionable, (3) highlight peluang naik level bila relevan. " +
      "Jangan mengarang angka yang tidak ada di input. Maksimal ±250 kata.",
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

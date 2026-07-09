import Anthropic from "@anthropic-ai/sdk";

/**
 * M8 §2B.4 — ringkasan naratif report brand: satu-satunya titik LLM di M8
 * (pola M2: 1 call di atas angka yang SUDAH dihitung, token di-log).
 * Semua dashboard/tracking/routing lain di M8 = 0 token AI.
 */
const DEFAULT_MODEL = "claude-haiku-4-5";

export interface BrandSummaryResult {
  text: string;
  tokensUsed: number;
}

export function summaryAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function generateBrandSummary(
  summary: Record<string, unknown>
): Promise<BrandSummaryResult> {
  if (!summaryAvailable()) {
    throw new Error("ANTHROPIC_API_KEY belum di-set — report brand tersimpan data-only");
  }
  const client = new Anthropic();

  const response = await client.messages.create({
    model: process.env.M2_INSIGHT_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system:
      "Kamu BizDev analyst agency MCN MEA (creator TikTok/Shopee). " +
      "Input adalah agregat performa campaign satu brand yang SUDAH dihitung (bukan data mentah). " +
      "Tulis dalam Bahasa Indonesia untuk pitch balik ke brand: " +
      "(1) ringkasan performa (GMV, ROAS bila ada, video, view), " +
      "(2) 2-3 poin kekuatan hasil kerja sama, " +
      "(3) bila field upgrade_recommendation true — rekomendasi naikkan investasi/scope dengan alasan berbasis angka. " +
      "Jangan mengarang angka yang tidak ada di input. Maksimal ±200 kata.",
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

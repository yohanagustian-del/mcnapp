/**
 * Rule-based feedback sentiment (PRD §3.8/PR-25, B4) — a PURE function, zero LLM
 * (CLAUDE.md #1: classification is deterministic, never per-row LLM calls).
 *
 * Primary signal = `rating_overall` (1-5) and `nps` (0-10), both numeric and always
 * present on a submitted form. Secondary/supporting signal = a word lexicon from
 * `app_config m7.sentiment_rules` (`{positif: string[], negatif: string[]}`, editable
 * without a deploy) matched against the free-text `best_part`/`improvement` fields —
 * it can only move a NUMERIC-BORDERLINE case, never override a clear numeric verdict.
 */

export interface SentimentLexicon {
  positif: string[];
  negatif: string[];
}

export interface FeedbackSentimentInput {
  ratingOverall: number;
  nps: number;
  bestPart?: string | null;
  improvement?: string | null;
  lexicon: SentimentLexicon;
}

export type Sentiment = "positif" | "netral" | "negatif";

export interface FeedbackSentimentResult {
  sentiment: Sentiment;
  /** -1 (paling negatif) .. 1 (paling positif) — for display/sorting only. */
  score: number;
}

function countLexiconHits(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((n, w) => (lower.includes(w.toLowerCase()) ? n + 1 : n), 0);
}

export function classifyFeedbackSentiment(input: FeedbackSentimentInput): FeedbackSentimentResult {
  const { ratingOverall, nps, lexicon } = input;

  // Primary numeric signal, normalized to -1..1 and weighted rating-heavier than
  // NPS (rating is asked about THIS event; NPS also carries general willingness-to-
  // recommend noise).
  const ratingNorm = (ratingOverall - 3) / 2; // 1->-1, 3->0, 5->1
  const npsNorm = (nps - 5) / 5; // 0->-1, 5->0, 10->1
  const numericScore = 0.6 * ratingNorm + 0.4 * npsNorm;

  const text = `${input.bestPart ?? ""} ${input.improvement ?? ""}`;
  const positifHits = countLexiconHits(text, lexicon.positif);
  const negatifHits = countLexiconHits(text, lexicon.negatif);
  const lexiconScore = positifHits === 0 && negatifHits === 0
    ? 0
    : (positifHits - negatifHits) / (positifHits + negatifHits);

  // Numeric is primary: a clear rating/NPS verdict is never flipped by wording.
  // Only when the numeric signal is itself borderline (near zero) does the
  // lexicon get a say — and even then only as a tie-breaker, weighted lightly.
  const numericIsBorderline = Math.abs(numericScore) < 0.2;
  const score = numericIsBorderline ? numericScore + 0.25 * lexiconScore : numericScore;

  let sentiment: Sentiment;
  if (score >= 0.2) sentiment = "positif";
  else if (score <= -0.2) sentiment = "negatif";
  else sentiment = "netral";

  return { sentiment, score: Math.max(-1, Math.min(1, score)) };
}

import { describe, expect, it } from "vitest";
import { classifyFeedbackSentiment, type SentimentLexicon } from "../feedback-sentiment";

const LEXICON: SentimentLexicon = {
  positif: ["bagus", "mantap", "membantu", "senang", "puas", "hebat", "seru"],
  negatif: ["kecewa", "buruk", "jelek", "lambat", "ribet", "berantakan", "payah"],
};

describe("classifyFeedbackSentiment", () => {
  it("classifies a clearly happy participant as positif from numbers alone", () => {
    const r = classifyFeedbackSentiment({
      ratingOverall: 5, nps: 10,
      bestPart: "Materinya oke", improvement: "",
      lexicon: LEXICON,
    });
    expect(r.sentiment).toBe("positif");
    expect(r.score).toBeGreaterThan(0);
  });

  it("classifies a clearly unhappy participant as negatif from numbers alone", () => {
    const r = classifyFeedbackSentiment({
      ratingOverall: 1, nps: 0,
      bestPart: "", improvement: "Semuanya",
      lexicon: LEXICON,
    });
    expect(r.sentiment).toBe("negatif");
    expect(r.score).toBeLessThan(0);
  });

  it("keeps a mid-range rating as netral when the comment carries no lexicon signal", () => {
    const r = classifyFeedbackSentiment({
      ratingOverall: 3, nps: 5,
      bestPart: "Lumayan lah", improvement: "Bisa lebih baik",
      lexicon: LEXICON,
    });
    expect(r.sentiment).toBe("netral");
  });

  it("uses the lexicon as a tie-breaker when the numeric signal is borderline positive", () => {
    const withoutComment = classifyFeedbackSentiment({
      ratingOverall: 3, nps: 6, bestPart: "", improvement: "", lexicon: LEXICON,
    });
    const withPositiveComment = classifyFeedbackSentiment({
      ratingOverall: 3, nps: 6,
      bestPart: "Mentornya bagus dan sangat membantu, acaranya seru", improvement: "",
      lexicon: LEXICON,
    });
    expect(withPositiveComment.score).toBeGreaterThan(withoutComment.score);
  });

  it("never flips a clearly negative numeric verdict even with a glowing comment", () => {
    // Numeric is primary — the PRD explicitly rules out letting free text override it.
    const r = classifyFeedbackSentiment({
      ratingOverall: 1, nps: 0,
      bestPart: "Sebenarnya mentornya bagus dan membantu, hebat kok", improvement: "",
      lexicon: LEXICON,
    });
    expect(r.sentiment).toBe("negatif");
  });

  it("recognizes a real-world mixed comment leaning negative", () => {
    const r = classifyFeedbackSentiment({
      ratingOverall: 2, nps: 3,
      bestPart: "Materinya lumayan",
      improvement: "Penyelenggaraannya berantakan, jadwal molor terus dan ribet daftar ulang",
      lexicon: LEXICON,
    });
    expect(r.sentiment).toBe("negatif");
  });

  it("recognizes a real-world enthusiastic comment", () => {
    const r = classifyFeedbackSentiment({
      ratingOverall: 5, nps: 9,
      bestPart: "Mentornya mantap banget, materinya membantu banget buat jualan live",
      improvement: "Udah bagus semua, lanjutkan!",
      lexicon: LEXICON,
    });
    expect(r.sentiment).toBe("positif");
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("always returns a score clamped to [-1, 1]", () => {
    const r = classifyFeedbackSentiment({ ratingOverall: 5, nps: 10, lexicon: LEXICON });
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.score).toBeGreaterThanOrEqual(-1);
  });
});

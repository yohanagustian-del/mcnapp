/**
 * M5 Creator–Campaign Matching — pure matching & ranking rules (PRD Module 05
 * §2.2–2.3). Deterministic pipeline: filter sub-category → filter/prioritize
 * price segment → weighted ranking → commission range. NO LLM per pair (0 token).
 *
 * Ranking weights are BALANCED by default and tunable via app_config
 * `m5.rank_weights`. GMV projection comes from the shared engine (lib/projection)
 * — never a second formula here.
 */

import type { GmvProjection, PriceSegment } from "@/lib/projection/gmv";

export interface RateRange {
  min: number; // percent
  max: number; // percent
}

/** Campaign candidate assembled from brand_deals (+ cooperating_shops categories). */
export interface CampaignCandidate {
  dealId: string;
  brandName: string;
  campaignName: string | null;
  shopId: string | null;
  /** Level 2 categories the campaign covers (deal niche + shop master categories). */
  subCategories: string[];
  /** Segment derived from the deal's avg_price; null when price is unknown. */
  segment: PriceSegment | null;
  /** Creator-side commission rate (potensi komisi kreator). */
  rateKreator: RateRange | null;
  /** MEA-side rate — attractiveness signal in ranking, not shown as creator commission. */
  rateMea: RateRange | null;
}

/** Creator profile aggregated from the rolling transaction window. */
export interface CreatorMatchProfile {
  creatorId: string;
  level: number | null;
  /** subcat(lower) → window GMV (all segments). */
  subcatGmv: Map<string, number>;
  /** `${subcat lower}|${segment}` → window GMV. */
  slotGmv: Map<string, number>;
  /** Overall GPM (GMV / 1000 views) — efficiency factor; null when views unknown. */
  gpm: number | null;
  /** Live share 0..1 — format-fit signal; null when no GMV. */
  liveShare: number | null;
}

export interface RankWeights {
  gmv: number;
  conversion: number;
  level_format: number;
  commission: number;
}

export interface MatchedCampaign extends CampaignCandidate {
  matchedSubcat: string;
  /** True when the campaign segment is one where the creator has proven GMV. */
  segmentMatch: boolean;
  /** Creator GMV basis used for projection: slot GMV, or subcat GMV when segment unknown. */
  basisGmv: number;
  score: number;
}

const midRate = (r: RateRange | null): number => (r ? (r.min + r.max) / 2 : 0);

/**
 * Step 1–2 (PRD §2.2): keep campaigns whose sub-category intersects the
 * creator's historical sub-categories; compute the projection basis from the
 * (subcat, segment) slot when the campaign price is known, else the subcat total.
 */
export function matchCampaigns(
  profile: CreatorMatchProfile,
  campaigns: CampaignCandidate[]
): Omit<MatchedCampaign, "score">[] {
  const out: Omit<MatchedCampaign, "score">[] = [];
  for (const c of campaigns) {
    let matchedSubcat: string | null = null;
    for (const raw of c.subCategories) {
      const sub = raw.trim().toLowerCase();
      if (sub && profile.subcatGmv.has(sub)) {
        // prefer the intersecting subcat with the largest creator GMV
        if (!matchedSubcat || (profile.subcatGmv.get(sub) ?? 0) > (profile.subcatGmv.get(matchedSubcat) ?? 0)) {
          matchedSubcat = sub;
        }
      }
    }
    if (!matchedSubcat) continue;

    const slotBasis = c.segment ? profile.slotGmv.get(`${matchedSubcat}|${c.segment}`) ?? 0 : 0;
    const segmentMatch = slotBasis > 0;
    const basisGmv = segmentMatch ? slotBasis : profile.subcatGmv.get(matchedSubcat) ?? 0;
    out.push({ ...c, matchedSubcat, segmentMatch, basisGmv });
  }
  return out;
}

/**
 * Step 3 (PRD §2.2): composite score, factors normalized 0..1 across candidates,
 * weights from app_config (balanced default). Factors:
 *  - gmv: creator GMV on the matched (subcat, segment); halved when the campaign
 *    segment is unknown or unproven for the creator (prioritas segmen kuat).
 *  - conversion: creator GPM (creator-level; differentiates in batch runs).
 *  - level_format: creator level (1..6) — format fit refined later.
 *  - commission: campaign rate midpoint (creator rate, fallback MEA rate).
 */
export function rankCampaigns(
  matched: Omit<MatchedCampaign, "score">[],
  profile: CreatorMatchProfile,
  weights: RankWeights
): MatchedCampaign[] {
  if (matched.length === 0) return [];
  const maxGmv = Math.max(...matched.map((m) => m.basisGmv), 1);
  const maxRate = Math.max(...matched.map((m) => midRate(m.rateKreator ?? m.rateMea)), 0.0001);
  const totalWeight =
    weights.gmv + weights.conversion + weights.level_format + weights.commission || 1;

  const scored = matched.map((m) => {
    const gmvScore = (m.basisGmv / maxGmv) * (m.segmentMatch ? 1 : 0.5);
    const conversionScore = profile.gpm === null ? 0.5 : Math.min(profile.gpm / 100_000, 1);
    const levelScore = profile.level ? profile.level / 6 : 0.5;
    const commissionScore = midRate(m.rateKreator ?? m.rateMea) / maxRate;
    const score =
      (weights.gmv * gmvScore +
        weights.conversion * conversionScore +
        weights.level_format * levelScore +
        weights.commission * commissionScore) /
      totalWeight;
    return { ...m, score: Math.round(score * 1000) / 1000 };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export interface CommissionRange {
  min: number;
  max: number;
}

/**
 * PRD §2.3: potensi komisi creator = proyeksi GMV (range) × rate komisi (range).
 * Null rate → null (UI shows "rate perlu review" instead of a fake number).
 */
export function commissionRange(
  projection: Pick<GmvProjection, "min" | "max">,
  rate: RateRange | null
): CommissionRange | null {
  if (!rate) return null;
  return {
    min: Math.round((projection.min * rate.min) / 100),
    max: Math.round((projection.max * rate.max) / 100),
  };
}

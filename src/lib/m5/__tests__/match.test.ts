import { describe, expect, it } from "vitest";
import {
  commissionRange,
  matchCampaigns,
  rankCampaigns,
  type CampaignCandidate,
  type CreatorMatchProfile,
  type RankWeights,
} from "../match";

const WEIGHTS: RankWeights = { gmv: 1, conversion: 1, level_format: 1, commission: 1 };

const profile: CreatorMatchProfile = {
  creatorId: "CRT-A",
  level: 4,
  subcatGmv: new Map([
    ["skincare serum", 20_000_000],
    ["lip tint", 5_000_000],
  ]),
  slotGmv: new Map([
    ["skincare serum|entry", 15_000_000],
    ["lip tint|low", 5_000_000],
  ]),
  gpm: 50_000,
  liveShare: 0.6,
};

const campaign = (over: Partial<CampaignCandidate>): CampaignCandidate => ({
  dealId: "DEAL-1",
  brandName: "Brand",
  campaignName: null,
  shopId: "123",
  subCategories: ["Skincare Serum"],
  segment: "entry",
  rateKreator: { min: 10, max: 10 },
  rateMea: { min: 5, max: 5 },
  ...over,
});

describe("matchCampaigns", () => {
  it("keeps only campaigns whose subcat intersects the creator history", () => {
    const matched = matchCampaigns(profile, [
      campaign({ dealId: "DEAL-1" }),
      campaign({ dealId: "DEAL-2", subCategories: ["Home Decor"] }),
    ]);
    expect(matched.map((m) => m.dealId)).toEqual(["DEAL-1"]);
    expect(matched[0].matchedSubcat).toBe("skincare serum");
  });

  it("uses the (subcat, segment) slot as basis when the segment is proven", () => {
    const [m] = matchCampaigns(profile, [campaign({})]);
    expect(m.segmentMatch).toBe(true);
    expect(m.basisGmv).toBe(15_000_000);
  });

  it("falls back to the subcat total when campaign price/segment is unknown", () => {
    const [m] = matchCampaigns(profile, [campaign({ segment: null })]);
    expect(m.segmentMatch).toBe(false);
    expect(m.basisGmv).toBe(20_000_000);
  });

  it("picks the intersecting subcat where the creator is strongest", () => {
    const [m] = matchCampaigns(profile, [
      campaign({ subCategories: ["Lip Tint", "Skincare Serum"], segment: null }),
    ]);
    expect(m.matchedSubcat).toBe("skincare serum");
  });
});

describe("rankCampaigns", () => {
  it("ranks stronger GMV basis + higher commission first (balanced weights)", () => {
    const matched = matchCampaigns(profile, [
      campaign({ dealId: "DEAL-LOW", rateKreator: { min: 2, max: 2 } }),
      campaign({ dealId: "DEAL-HIGH", rateKreator: { min: 15, max: 15 } }),
      campaign({ dealId: "DEAL-WEAK", subCategories: ["Lip Tint"], segment: "entry", rateKreator: { min: 15, max: 15 } }),
    ]);
    const ranked = rankCampaigns(matched, profile, WEIGHTS);
    expect(ranked[0].dealId).toBe("DEAL-HIGH");
    // weak subcat + unproven segment (halved gmv factor) ranks below same-rate strong match
    expect(ranked.map((r) => r.dealId).indexOf("DEAL-WEAK")).toBeGreaterThan(
      ranked.map((r) => r.dealId).indexOf("DEAL-HIGH")
    );
    expect(ranked.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);
  });

  it("respects tunable weights (commission-only weights reorder)", () => {
    const matched = matchCampaigns(profile, [
      campaign({ dealId: "DEAL-A", rateKreator: { min: 3, max: 3 } }),
      campaign({ dealId: "DEAL-B", subCategories: ["Lip Tint"], segment: "low", rateKreator: { min: 12, max: 12 } }),
    ]);
    const commissionOnly = rankCampaigns(matched, profile, { gmv: 0, conversion: 0, level_format: 0, commission: 1 });
    expect(commissionOnly[0].dealId).toBe("DEAL-B");
  });
});

describe("commissionRange", () => {
  it("multiplies GMV range by rate range (PRD §2.3 example shape)", () => {
    // proyeksi 15–25jt × 12% → 1,8–3jt
    expect(commissionRange({ min: 15_000_000, max: 25_000_000 }, { min: 12, max: 12 }))
      .toEqual({ min: 1_800_000, max: 3_000_000 });
  });

  it("returns null when the rate needs review", () => {
    expect(commissionRange({ min: 1, max: 2 }, null)).toBeNull();
  });
});

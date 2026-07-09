import { describe, expect, it } from "vitest";
import {
  computePctProgress,
  countAchievedKrs,
  formatPct,
  handsOnRatio,
  isAchieved,
  isGatingTriggered,
  isRewardTbd,
  mapRewardTier,
  okrStatusLabel,
  statusBadgeClass,
} from "../scoring";

describe("computePctProgress (PRD M3 §2.2 — LOCKED)", () => {
  it("result = actual / target", () => {
    expect(computePctProgress(80, 100)).toBeCloseTo(0.8);
    expect(computePctProgress(100, 100)).toBeCloseTo(1.0);
    expect(computePctProgress(115, 100)).toBeCloseTo(1.15);
  });

  it("progres boleh > 100% (over-achieve)", () => {
    expect(computePctProgress(200, 100)).toBeCloseTo(2.0);
  });

  it("target 0 → return 0 (guard pembagi nol)", () => {
    expect(computePctProgress(50, 0)).toBe(0);
  });
});

describe("isAchieved (PRD M3 §2.2 — LOCKED biner)", () => {
  it("achieved tepat di 100%", () => expect(isAchieved(1.0)).toBe(true));
  it("achieved di atas 100%", () => expect(isAchieved(1.5)).toBe(true));
  it("belum achieved di 99%", () => expect(isAchieved(0.999)).toBe(false));
  it("belum achieved di 0%", () => expect(isAchieved(0)).toBe(false));
});

describe("countAchievedKrs", () => {
  it("menghitung KR yang achieved = true", () => {
    expect(
      countAchievedKrs([
        { achieved: true },
        { achieved: false },
        { achieved: true },
      ])
    ).toBe(2);
  });

  it("list kosong → 0", () => expect(countAchievedKrs([])).toBe(0));
});

describe("mapRewardTier (PRD M3 §2.5)", () => {
  const tiers = [
    { role: "cpm", kr_achieved_count: 3, reward_amount: 1_500_000 },
    { role: "cpm", kr_achieved_count: 4, reward_amount: 5_000_000 },
    { role: "bizdev", kr_achieved_count: 3, reward_amount: 2_000_000 },
    { role: "bizdev", kr_achieved_count: 4, reward_amount: 6_000_000 },
  ];

  it("tier tertinggi yang eligible dipilih", () => {
    expect(mapRewardTier("cpm", 4, tiers)).toBe(5_000_000);
    expect(mapRewardTier("cpm", 3, tiers)).toBe(1_500_000);
  });

  it("di bawah threshold minimum → null", () => {
    expect(mapRewardTier("cpm", 2, tiers)).toBeNull();
  });

  it("role tidak ada → null", () => {
    expect(mapRewardTier("acquisition_spec", 4, tiers)).toBeNull();
  });
});

describe("isRewardTbd", () => {
  it("reward_amount null = TBD", () => {
    const tiers = [{ role: "cm_lead", kr_achieved_count: 3, reward_amount: null }];
    expect(isRewardTbd("cm_lead", 4, tiers)).toBe(true);
  });

  it("reward_amount 0 bukan TBD (sengaja 0)", () => {
    const tiers = [{ role: "cm_lead", kr_achieved_count: 3, reward_amount: 0 }];
    expect(isRewardTbd("cm_lead", 4, tiers)).toBe(false);
  });
});

describe("handsOnRatio (PRD M3 §2.7 — korelasional)", () => {
  it("rasio GMV naik dengan aktivitas CPM vs total naik", () => {
    const activities = [
      { creator_id: "CRT-001", has_activity: true,  gmv_delta: 1_000_000 },
      { creator_id: "CRT-002", has_activity: false, gmv_delta: 2_000_000 },
    ];
    expect(handsOnRatio(activities)).toBeCloseTo(1_000_000 / 3_000_000);
  });

  it("creator dengan delta 0 atau negatif diabaikan", () => {
    const activities = [
      { creator_id: "CRT-001", has_activity: true,  gmv_delta: 500_000 },
      { creator_id: "CRT-002", has_activity: true,  gmv_delta: 0 },       // diabaikan
      { creator_id: "CRT-003", has_activity: false, gmv_delta: -200_000 }, // turun, diabaikan
    ];
    expect(handsOnRatio(activities)).toBeCloseTo(1.0); // semua naik punya aktivitas
  });

  it("tidak ada creator yang naik → null", () => {
    const activities = [
      { creator_id: "CRT-001", has_activity: true, gmv_delta: -100 },
    ];
    expect(handsOnRatio(activities)).toBeNull();
  });

  it("list kosong → null", () => {
    expect(handsOnRatio([])).toBeNull();
  });
});

describe("isGatingTriggered (PRD M3 §2.3 — LOCKED: TANDAI bukan auto-gugur)", () => {
  it("type any_occurrence + ada evidence → triggered", () => {
    expect(isGatingTriggered({ type: "any_occurrence" }, true)).toBe(true);
  });

  it("type any_occurrence + tidak ada evidence → tidak triggered", () => {
    expect(isGatingTriggered({ type: "any_occurrence" }, false)).toBe(false);
  });

  it("gating_rule null → tidak triggered (KR tanpa gating)", () => {
    expect(isGatingTriggered(null, true)).toBe(false);
    expect(isGatingTriggered(undefined, true)).toBe(false);
  });
});

describe("okrStatusLabel", () => {
  it("achieved ≥ 100%", () => expect(okrStatusLabel(1.0, false)).toBe("achieved"));
  it("berisiko-gugur override pct", () => expect(okrStatusLabel(1.0, true)).toBe("berisiko-gugur"));
  it("on-track 70%–99%", () => expect(okrStatusLabel(0.75, false)).toBe("on-track"));
  it("at-risk < 70%", () => expect(okrStatusLabel(0.5, false)).toBe("at-risk"));
  it("belum-ada-data pct negatif", () => expect(okrStatusLabel(-1, false)).toBe("belum-ada-data"));
});

describe("statusBadgeClass", () => {
  it("achieved → green", () => expect(statusBadgeClass("achieved")).toContain("green"));
  it("berisiko-gugur → red", () => expect(statusBadgeClass("berisiko-gugur")).toContain("red"));
  it("on-track → blue", () => expect(statusBadgeClass("on-track")).toContain("blue"));
});

describe("formatPct", () => {
  it("0.82 → 82%", () => expect(formatPct(0.82)).toBe("82%"));
  it("1.15 → 115%", () => expect(formatPct(1.15)).toBe("115%"));
  it("negatif → —", () => expect(formatPct(-1)).toBe("—"));
});

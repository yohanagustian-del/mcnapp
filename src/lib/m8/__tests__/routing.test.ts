import { describe, expect, it } from "vitest";
import {
  adsNeedsDirectorApproval,
  applyBrandAcc,
  applyCmConfirm,
  canHandover,
  initialRequestState,
  isPerfDrop,
  latestTwoPeriods,
  shouldRecommendUpgrade,
  successRate,
  type PeriodSummaryPoint,
} from "../routing";

describe("campaign request routing state machine (PRD M8 §2E)", () => {
  it("starts waiting for CM, brand gate closed until creator says yes", () => {
    const s = initialRequestState(true);
    expect(s).toEqual({
      cm_confirm_status: "menunggu",
      needs_brand_acc: true,
      brand_acc_status: "n_a",
      final_status: "proses",
    });
  });

  it("creator mau + no brand acc → fix langsung", () => {
    const s = applyCmConfirm(initialRequestState(false), "mau");
    expect(s.final_status).toBe("fix");
    expect(s.brand_acc_status).toBe("n_a");
    expect(canHandover(s)).toBe(true);
  });

  it("creator mau + needs brand acc → menunggu acc brand (belum fix)", () => {
    const s = applyCmConfirm(initialRequestState(true), "mau");
    expect(s.final_status).toBe("proses");
    expect(s.brand_acc_status).toBe("menunggu");
    expect(canHandover(s)).toBe(false);
  });

  it("creator tidak → batal, apa pun kebutuhan brand acc", () => {
    const s = applyCmConfirm(initialRequestState(true), "tidak");
    expect(s.final_status).toBe("batal");
    expect(s.brand_acc_status).toBe("n_a");
  });

  it("brand approve → fix; brand tolak → batal", () => {
    const waiting = applyCmConfirm(initialRequestState(true), "mau");
    expect(applyBrandAcc(waiting, "approved").final_status).toBe("fix");
    expect(applyBrandAcc(waiting, "ditolak").final_status).toBe("batal");
  });

  it("guards: no double CM confirm, no brand acc without gate, no action after final", () => {
    const confirmed = applyCmConfirm(initialRequestState(false), "mau");
    expect(() => applyCmConfirm(confirmed, "mau")).toThrow(/sudah/);

    const fresh = initialRequestState(true);
    expect(() => applyBrandAcc(fresh, "approved")).toThrow(/menunggu acc brand/);

    const noGate = applyCmConfirm(initialRequestState(false), "mau");
    expect(() => applyBrandAcc(noGate, "approved")).toThrow();

    const batal = applyCmConfirm(initialRequestState(false), "tidak");
    expect(() => applyCmConfirm(batal, "mau")).toThrow(/batal/);
  });
});

describe("isPerfDrop (§2A.2 — GMV turun >15% minggu-ke-minggu, LOCKED)", () => {
  it("flags a drop beyond the threshold", () => {
    expect(isPerfDrop(80, 100, 0.15)).toBe(true); // -20%
  });
  it("does not flag at or under the threshold, growth, or missing basis", () => {
    expect(isPerfDrop(85, 100, 0.15)).toBe(false); // exactly -15%
    expect(isPerfDrop(120, 100, 0.15)).toBe(false);
    expect(isPerfDrop(50, 0, 0.15)).toBe(false); // no previous week
  });
});

describe("adsNeedsDirectorApproval (§6.4 — lewat cap / tak terverifikasi → approval)", () => {
  it("over cap → approval; within cap → auto", () => {
    expect(adsNeedsDirectorApproval(5_000_000, 4_000_000)).toBe(true);
    expect(adsNeedsDirectorApproval(3_000_000, 4_000_000)).toBe(false);
    expect(adsNeedsDirectorApproval(4_000_000, 4_000_000)).toBe(false);
  });
  it("unverifiable (missing cap or amount) → approval", () => {
    expect(adsNeedsDirectorApproval(5_000_000, null)).toBe(true);
    expect(adsNeedsDirectorApproval(null, 4_000_000)).toBe(true);
  });
});

describe("shouldRecommendUpgrade (§6.5 — ROAS tinggi + GMV tinggi, tunable)", () => {
  const cfg = { roasMin: 3, gmvMin: 500_000_000 };
  it("both thresholds met → recommend", () => {
    expect(shouldRecommendUpgrade(600_000_000, 3.5, cfg)).toBe(true);
  });
  it("one threshold missing → no recommendation", () => {
    expect(shouldRecommendUpgrade(600_000_000, 2.9, cfg)).toBe(false);
    expect(shouldRecommendUpgrade(400_000_000, 4, cfg)).toBe(false);
  });
  it("no ads spend → no ROAS basis → no recommendation", () => {
    expect(shouldRecommendUpgrade(900_000_000, null, cfg)).toBe(false);
  });
});

describe("successRate (§2D.1)", () => {
  it("computes rate and returns null without basis", () => {
    expect(successRate(20, 5)).toBe(0.25);
    expect(successRate(0, 0)).toBeNull();
  });
});

describe("latestTwoPeriods (creator_period_summary → CM growth column, Module 0.5 Fase 2)", () => {
  const row = (p: Partial<PeriodSummaryPoint>): PeriodSummaryPoint => ({
    periodStart: "2026-07-01", periodEnd: "2026-07-07", uploadBatch: "b1",
    affiliateGmv: 0, createdAt: "2026-07-08T00:00:00Z", ...p,
  });

  it("returns current = latest period, previous = period before it", () => {
    const rows = [
      row({ periodStart: "2026-06-24", periodEnd: "2026-06-30", affiliateGmv: 100_000_000, createdAt: "2026-07-01T00:00:00Z" }),
      row({ periodStart: "2026-07-01", periodEnd: "2026-07-07", affiliateGmv: 453_000_000, createdAt: "2026-07-08T00:00:00Z" }),
    ];
    const g = latestTwoPeriods(rows);
    expect(g).toEqual({ current: 453_000_000, previous: 100_000_000, periodStart: "2026-07-01", periodEnd: "2026-07-07" });
  });

  it("one period only → previous null", () => {
    const g = latestTwoPeriods([row({ affiliateGmv: 237_900 })]);
    expect(g).toEqual({ current: 237_900, previous: null, periodStart: "2026-07-01", periodEnd: "2026-07-07" });
  });

  it("no rows → null", () => {
    expect(latestTwoPeriods([])).toBeNull();
  });

  it("same period_start with 2 batches (re-upload/correction) → keeps only the latest batch by created_at", () => {
    const rows = [
      row({ periodStart: "2026-07-01", affiliateGmv: 237_900, uploadBatch: "ingest:2026-07-01", createdAt: "2026-07-02T09:00:00Z" }),
      row({ periodStart: "2026-07-01", affiliateGmv: 453_000_000, uploadBatch: "pm:mcn_tiktok_product:2026-07-01", createdAt: "2026-07-08T10:00:00Z" }),
    ];
    const g = latestTwoPeriods(rows);
    expect(g?.current).toBe(453_000_000); // not summed, not the stale 237_900 row
  });

  it("multiple day-buckets never happen post-Fase-2 dual-write, but if given several distinct period_start values, dedupes per-period before sorting", () => {
    const rows = [
      row({ periodStart: "2026-06-24", affiliateGmv: 10, createdAt: "2026-06-25T00:00:00Z" }),
      row({ periodStart: "2026-06-24", affiliateGmv: 20, createdAt: "2026-06-26T00:00:00Z" }), // newer batch wins for this period
      row({ periodStart: "2026-07-01", affiliateGmv: 30, createdAt: "2026-07-02T00:00:00Z" }),
    ];
    const g = latestTwoPeriods(rows);
    expect(g).toEqual({ current: 30, previous: 20, periodStart: "2026-07-01", periodEnd: "2026-07-07" });
  });
});

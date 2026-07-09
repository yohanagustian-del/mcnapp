import { describe, expect, it } from "vitest";
import {
  allocateAgencyGmv,
  classifyPairStatus,
  leadPriority,
  rollupCreatorStatus,
  shopDealState,
} from "../classify";

const THRESHOLDS = { sebagian: 0.1, total: 0.5 };

describe("allocateAgencyGmv", () => {
  it("returns full agency gmv for a single-creator pair (share = 1)", () => {
    expect(allocateAgencyGmv(1_000_000, 1_000_000, 600_000)).toBe(600_000);
  });
  it("allocates proportionally across creators", () => {
    // creator holds 25% of the pair GMV → gets 25% of agency GMV
    expect(allocateAgencyGmv(250_000, 1_000_000, 600_000)).toBe(150_000);
  });
  it("caps allocation at the creator's own GMV", () => {
    expect(allocateAgencyGmv(100_000, 100_000, 500_000)).toBe(100_000);
  });
  it("returns 0 for zero denominators", () => {
    expect(allocateAgencyGmv(0, 0, 500_000)).toBe(0);
  });
});

describe("classifyPairStatus", () => {
  it("via_agency when all gmv went through the agency link", () => {
    expect(classifyPairStatus(1_000_000, 1_000_000)).toBe("via_agency");
  });
  it("tolerates sub-rupiah rounding noise", () => {
    expect(classifyPairStatus(1_000_000.4, 1_000_000)).toBe("via_agency");
  });
  it("bocor_total when nothing went through the agency link", () => {
    expect(classifyPairStatus(1_000_000, 0)).toBe("bocor_total");
  });
  it("bocor_sebagian for a partial diff", () => {
    expect(classifyPairStatus(1_000_000, 600_000)).toBe("bocor_sebagian");
  });
});

describe("rollupCreatorStatus", () => {
  it("belum_ada_link when the creator has no active-deal-shop gmv", () => {
    expect(rollupCreatorStatus(0, 0, THRESHOLDS)).toEqual({ leakRatio: null, status: "belum_ada_link" });
  });
  it("via_agency at/below the sebagian threshold", () => {
    expect(rollupCreatorStatus(100, 10, THRESHOLDS).status).toBe("via_agency");
  });
  it("bocor_sebagian between thresholds (PRD example: 25%)", () => {
    const r = rollupCreatorStatus(100_000_000, 25_000_000, THRESHOLDS);
    expect(r.status).toBe("bocor_sebagian");
    expect(r.leakRatio).toBeCloseTo(0.25);
  });
  it("bocor_total above the total threshold", () => {
    expect(rollupCreatorStatus(100, 51, THRESHOLDS).status).toBe("bocor_total");
  });
});

describe("leadPriority", () => {
  it("multiplies frequency by gmv (PRD LOCKED default)", () => {
    expect(leadPriority(15, 30_000_000)).toBe(450_000_000);
  });
});

describe("shopDealState", () => {
  it("none when the shop is not in the master", () => {
    expect(shopDealState(undefined, "2026-07-01")).toBe("none");
  });
  it("active when deal_end is in the future", () => {
    expect(shopDealState({ deal_end: "2026-12-31" }, "2026-07-01")).toBe("active");
  });
  it("active when deal_end is unknown (master lists the shop as cooperating)", () => {
    expect(shopDealState({ deal_end: null }, "2026-07-01")).toBe("active");
  });
  it("expired when deal_end has passed", () => {
    expect(shopDealState({ deal_end: "2026-06-30" }, "2026-07-01")).toBe("expired");
  });
  it("active when absent from master but recorded agency-link (TAP) GMV", () => {
    expect(shopDealState(undefined, "2026-07-01", true)).toBe("active");
  });
  it("still none when absent from master and no agency GMV", () => {
    expect(shopDealState(undefined, "2026-07-01", false)).toBe("none");
  });
});

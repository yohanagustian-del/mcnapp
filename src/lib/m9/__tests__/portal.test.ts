import { describe, it, expect } from "vitest";
import {
  weekStart,
  hasReportCredit,
  nextCreditDate,
  immutableViolations,
  assertComplaintMutationAllowed,
  aggregateComplaints,
  stripPlanForCreator,
  planExposesForbiddenField,
  DEFAULT_SEVERITY_WEIGHTS,
  CREATOR_PLAN_FIELDS,
  type ComplaintCore,
  type ComplaintRow,
} from "../portal";

describe("M9 report credit window (§2.3 — 1/creator/week, expires)", () => {
  it("weekStart returns Monday for any weekday", () => {
    expect(weekStart(new Date("2026-07-08T10:00:00Z"))).toBe("2026-07-06"); // Wed → Mon
    expect(weekStart(new Date("2026-07-06T00:00:00Z"))).toBe("2026-07-06"); // Mon → Mon
  });
  it("weekStart handles Sunday as end of the same week (not next)", () => {
    expect(weekStart(new Date("2026-07-12T23:59:00Z"))).toBe("2026-07-06"); // Sun → prior Mon
  });
  it("grants a credit when none used this week", () => {
    expect(hasReportCredit(new Date("2026-07-08T10:00:00Z"), [])).toBe(true);
    expect(hasReportCredit(new Date("2026-07-08T10:00:00Z"), ["2026-06-29"])).toBe(true);
  });
  it("blocks a second credit in the same week (no bypass)", () => {
    expect(hasReportCredit(new Date("2026-07-08T10:00:00Z"), ["2026-07-06"])).toBe(false);
  });
  it("does NOT accumulate: unused past weeks grant nothing extra", () => {
    // used once this week already → still blocked regardless of many unused past weeks
    const used = ["2026-05-04", "2026-05-11", "2026-07-06"];
    expect(hasReportCredit(new Date("2026-07-09T10:00:00Z"), used)).toBe(false);
  });
  it("resets the following Monday", () => {
    expect(nextCreditDate(new Date("2026-07-08T10:00:00Z"))).toBe("2026-07-13");
    expect(hasReportCredit(new Date("2026-07-13T00:00:00Z"), ["2026-07-06"])).toBe(true);
  });
});

describe("M9 complaint immutability (§2.7 — CPM closes, cannot edit)", () => {
  const base: ComplaintCore = { body: "CM lambat", creator_id: "CRT-001", severity: "tinggi", category: "cm_tidak_responsif" };
  it("allows a status-only close (no core field change)", () => {
    expect(immutableViolations(base, { ...base })).toEqual([]);
    expect(() => assertComplaintMutationAllowed(base, { ...base })).not.toThrow();
  });
  it("flags a body edit", () => {
    expect(immutableViolations(base, { ...base, body: "diedit" })).toEqual(["body"]);
    expect(() => assertComplaintMutationAllowed(base, { ...base, body: "diedit" })).toThrow(/immutable/);
  });
  it("flags severity downgrade (burying the signal)", () => {
    expect(immutableViolations(base, { ...base, severity: "rendah" })).toEqual(["severity"]);
    expect(() => assertComplaintMutationAllowed(base, { ...base, severity: "rendah" })).toThrow();
  });
  it("flags creator_id and category tampering", () => {
    expect(immutableViolations(base, { ...base, creator_id: "CRT-999" })).toEqual(["creator_id"]);
    expect(immutableViolations(base, { ...base, category: "lainnya" })).toEqual(["category"]);
  });
  it("reports multiple violations at once", () => {
    expect(immutableViolations(base, { body: "x", creator_id: "CRT-9", severity: "rendah", category: "lainnya" }))
      .toEqual(["body", "creator_id", "severity", "category"]);
  });
});

describe("M9 CPM health aggregation (§2.7 — closed complaints still count)", () => {
  const rows: ComplaintRow[] = [
    { target_cpm_id: "cpm-1", creator_id: "CRT-1", severity: "tinggi", status: "selesai" },
    { target_cpm_id: "cpm-1", creator_id: "CRT-1", severity: "sedang", status: "baru" },
    { target_cpm_id: "cpm-1", creator_id: "CRT-2", severity: "rendah", status: "selesai" },
  ];
  it("counts every complaint including status=selesai", () => {
    const s = aggregateComplaints(rows);
    expect(s.complaintCount).toBe(3); // 2 of which are 'selesai'
  });
  it("weights severity with default weights (3+2+1)", () => {
    expect(aggregateComplaints(rows).weightedSeverity).toBe(6);
  });
  it("closing a complaint does not reduce its weight", () => {
    const allClosed = rows.map((r) => ({ ...r, status: "selesai" as const }));
    expect(aggregateComplaints(allClosed).weightedSeverity).toBe(aggregateComplaints(rows).weightedSeverity);
  });
  it("detects repeat-complaint creators (CRT-1 twice)", () => {
    expect(aggregateComplaints(rows).repeatCreators).toBe(1);
  });
  it("no repeat when each creator complains once", () => {
    const once: ComplaintRow[] = [
      { target_cpm_id: "cpm-2", creator_id: "CRT-3", severity: "sedang", status: "baru" },
      { target_cpm_id: "cpm-2", creator_id: "CRT-4", severity: "sedang", status: "baru" },
    ];
    expect(aggregateComplaints(once).repeatCreators).toBe(0);
  });
  it("respects tunable severity weights from app_config", () => {
    const s = aggregateComplaints(rows, { rendah: 0, sedang: 5, tinggi: 10 });
    expect(s.weightedSeverity).toBe(10 + 5 + 0);
  });
  it("empty input yields a zeroed signal", () => {
    expect(aggregateComplaints([])).toEqual({ complaintCount: 0, weightedSeverity: 0, repeatCreators: 0 });
  });
  it("exports the locked default weights", () => {
    expect(DEFAULT_SEVERITY_WEIGHTS).toEqual({ rendah: 1, sedang: 2, tinggi: 3 });
  });
});

describe("M9 agency plan strip (§2.4 — komisi_mea never surfaced)", () => {
  const raw = {
    deal_id: "DEAL-1", product_id: "P1", product_name: "Serum",
    link: "https://x", niche: "beauty", komisi_kreator: 15,
    komisi_mea: 8, komisi_mea_pct: 8, margin: 1000, service_fee: 500, ads_budget: 2000,
    exp_date: "2026-12-01", status: "running", notes: "internal",
  };
  it("keeps komisi_kreator and product fields", () => {
    const out = stripPlanForCreator(raw);
    expect(out.komisi_kreator).toBe(15);
    expect(out.product_name).toBe("Serum");
    expect(out.link).toBe("https://x");
  });
  it("removes komisi_mea, margin, service_fee, ads_budget, notes", () => {
    const out = stripPlanForCreator(raw) as Record<string, unknown>;
    for (const forbidden of ["komisi_mea", "komisi_mea_pct", "margin", "service_fee", "ads_budget", "notes"]) {
      expect(forbidden in out).toBe(false);
    }
  });
  it("planExposesForbiddenField detects a leak before it reaches a creator", () => {
    expect(planExposesForbiddenField(raw)).toBe(true);
    expect(planExposesForbiddenField(stripPlanForCreator(raw) as Record<string, unknown>)).toBe(false);
  });
  it("CREATOR_PLAN_FIELDS whitelist contains no forbidden column", () => {
    for (const f of CREATOR_PLAN_FIELDS) {
      expect(["komisi_mea", "komisi_mea_pct", "margin", "service_fee", "ads_budget", "notes"]).not.toContain(f);
    }
    expect(CREATOR_PLAN_FIELDS).toContain("komisi_kreator");
  });
});

describe("M9 credit window — edge cases", () => {
  it("handles the ISO year boundary", () => {
    // 2027-01-01 is a Friday → week Monday 2026-12-28
    expect(weekStart(new Date("2027-01-01T12:00:00Z"))).toBe("2026-12-28");
  });
  it("accepts a Set as the used-weeks source", () => {
    const used = new Set(["2026-07-06"]);
    expect(hasReportCredit(new Date("2026-07-07T00:00:00Z"), used)).toBe(false);
    expect(hasReportCredit(new Date("2026-07-14T00:00:00Z"), used)).toBe(true);
  });
  it("nextCreditDate is always the Monday after the current week", () => {
    expect(nextCreditDate(new Date("2026-07-06T00:00:00Z"))).toBe("2026-07-13");
    expect(nextCreditDate(new Date("2026-07-12T23:59:00Z"))).toBe("2026-07-13");
  });
});

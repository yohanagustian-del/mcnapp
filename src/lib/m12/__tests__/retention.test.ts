import { describe, it, expect } from "vitest";
import {
  isWindowValid,
  assertWindowValid,
  retentionCutoff,
  cutoffInsideModuleWindow,
  shouldPurgeRow,
  isPurgeable,
  isProtected,
  PROTECTED_TABLES,
  MIN_WINDOW_DAYS,
} from "../retention";

describe("M12 config validation (§2.2 — reject window < 28 days)", () => {
  it("rejects windows shorter than the module minimum", () => {
    expect(isWindowValid(20)).toBe(false);
    expect(() => assertWindowValid(20)).toThrow(/minimal 28 hari/);
  });
  it("accepts the minimum and above", () => {
    expect(isWindowValid(28)).toBe(true);
    expect(isWindowValid(180)).toBe(true);
    expect(() => assertWindowValid(28)).not.toThrow();
  });
  it("exposes the hard floor", () => {
    expect(MIN_WINDOW_DAYS).toBe(28);
  });
});

describe("M12 cutoff + window guard (§2.2 — never prune inside 28d)", () => {
  it("computes the cutoff as start-of-month minus window", () => {
    expect(retentionCutoff(new Date("2026-07-06T00:00:00Z"), 6)).toBe("2026-01-01");
  });
  it("a 6-month cutoff is safely outside the module window", () => {
    expect(cutoffInsideModuleWindow("2026-01-01", new Date("2026-07-06T00:00:00Z"))).toBe(false);
  });
  it("a tiny window pulls the cutoff inside the 28-day guard → abort", () => {
    const cutoff = retentionCutoff(new Date("2026-07-06T00:00:00Z"), 0); // start of this month
    expect(cutoffInsideModuleWindow(cutoff, new Date("2026-07-06T00:00:00Z"))).toBe(true);
  });
});

describe("M12 aggregate-then-purge (§2.2 — aggregate first)", () => {
  it("purges an old row only when its month is aggregated", () => {
    expect(shouldPurgeRow("2025-12-15", "2026-01-01", true)).toBe(true);
  });
  it("does NOT purge when the month is not yet aggregated (data-safety)", () => {
    expect(shouldPurgeRow("2025-12-15", "2026-01-01", false)).toBe(false);
  });
  it("does NOT purge rows newer than the cutoff even if aggregated", () => {
    expect(shouldPurgeRow("2026-02-15", "2026-01-01", true)).toBe(false);
  });
});

describe("M12 protected tables (§2.6 — identity/deal/audit never purged)", () => {
  it("only raw metric/transaction tables are purgeable", () => {
    expect(isPurgeable("platform_metrics_raw")).toBe(true);
    expect(isPurgeable("transactions_all")).toBe(true);
    expect(isPurgeable("transactions_agency_link")).toBe(true);
  });
  it("identity/deal/agency/audit tables are protected", () => {
    for (const t of ["creators", "brand_deals", "agency_links", "audit_logs", "team_members", "creator_users"]) {
      expect(isProtected(t)).toBe(true);
      expect(isPurgeable(t)).toBe(false);
    }
  });
  it("aggregate store itself is protected (trend must survive)", () => {
    expect(isProtected("metrics_monthly_agg")).toBe(true);
    expect(PROTECTED_TABLES).toContain("metrics_monthly_agg");
  });
});

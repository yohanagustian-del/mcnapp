import { describe, it, expect } from "vitest";
import { PERMISSIONS, hasPermission, canAccessNav, NAV_ITEMS, type Role } from "@/lib/rbac";

/**
 * M11 §2A.3 (CRITICAL) — od_viewer is read-only ABSOLUTE. Every mutation endpoint is gated by
 * requirePermission(<key>), which checks this matrix server-side (not just UI). These negative
 * tests assert od_viewer is rejected on each write endpoint. requirePermission throws whenever
 * hasPermission returns false, so proving the matrix rejects od_viewer proves the server rejects it.
 */

// Every mutation permission key in the system → od_viewer must have NONE of them.
const MUTATION_ENDPOINTS = Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[];

describe("M11 — od_viewer rejected on EVERY mutation endpoint (server-side)", () => {
  it("covers at least 15 distinct mutation endpoints", () => {
    expect(MUTATION_ENDPOINTS.length).toBeGreaterThanOrEqual(15);
  });

  // One explicit negative test per endpoint (named in output for audit clarity).
  for (const endpoint of MUTATION_ENDPOINTS) {
    it(`rejects od_viewer for '${endpoint}'`, () => {
      expect(hasPermission(endpoint, "od_viewer")).toBe(false);
    });
  }
});

describe("M11 — od_viewer read access is preserved", () => {
  it("can open the OD oversight nav", () => {
    const od = NAV_ITEMS.find((n) => n.href === "/od");
    expect(od).toBeDefined();
    expect(canAccessNav(od!, "od_viewer")).toBe(true);
  });
  it("can view the retention (read) dashboard nav", () => {
    const ret = NAV_ITEMS.find((n) => n.href === "/admin/retention");
    expect(canAccessNav(ret!, "od_viewer")).toBe(true);
  });
});

describe("M11 — multi-Director equality (any Director suffices, audited per-actor)", () => {
  it("director retains every approval/config endpoint", () => {
    const directorEndpoints: (keyof typeof PERMISSIONS)[] = [
      "m3.set_target", "m3.gating_decision", "m3.snapshot",
      "m8.ads_approve", "m10.budget_approve", "m11.manage_accounts",
      "m12.set_policy", "m12.run_maintenance", "m12.purge_manual",
    ];
    for (const e of directorEndpoints) expect(hasPermission(e, "director")).toBe(true);
  });
  it("od_viewer specifically cannot approve budgets, manage accounts, or set retention", () => {
    for (const e of ["m10.budget_approve", "m11.manage_accounts", "m12.set_policy", "m8.ads_approve"] as const) {
      expect(hasPermission(e, "od_viewer" as Role)).toBe(false);
    }
  });
});

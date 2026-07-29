import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  OD_OKR_PERMISSIONS,
  hasPermission,
  canAccessNav,
  NAV_ITEMS,
  type Role,
} from "@/lib/rbac";

/**
 * M11 §2A.3 — od_viewer is read-only, with ONE carve-out (revisi role 2026-07-29):
 * the M3 OKR exception (OD_OKR_PERMISSIONS = set target, set reward, trigger scoring)
 * so OD can configure OKR and analyze team results. Every OTHER mutation endpoint is
 * gated by requirePermission(<key>), which checks this matrix server-side (not just UI).
 * requirePermission throws whenever hasPermission returns false, so proving the matrix
 * rejects od_viewer proves the server rejects it.
 */

const OKR_EXCEPTION = new Set<string>(OD_OKR_PERMISSIONS);

// Every mutation permission key OUTSIDE the OKR exception → od_viewer must have NONE of them.
const MUTATION_ENDPOINTS = (Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[])
  .filter((k) => !OKR_EXCEPTION.has(k));

describe("M11 — od_viewer rejected on every non-OKR mutation endpoint (server-side)", () => {
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

describe("M3 OKR exception — od_viewer sets OKR & analyzes team results (revisi 2026-07-29)", () => {
  it("exception list is exactly set_target + set_reward + score", () => {
    expect([...OD_OKR_PERMISSIONS].sort()).toEqual(["m3.score", "m3.set_reward", "m3.set_target"]);
  });
  for (const endpoint of OD_OKR_PERMISSIONS) {
    it(`grants od_viewer '${endpoint}'`, () => {
      expect(hasPermission(endpoint, "od_viewer")).toBe(true);
    });
  }
  it("gating decision & snapshot stay Director-only (PRD §2.3 LOCKED)", () => {
    expect(hasPermission("m3.gating_decision", "od_viewer")).toBe(false);
    expect(hasPermission("m3.snapshot", "od_viewer")).toBe(false);
    expect(PERMISSIONS["m3.gating_decision"]).toEqual(["director"]);
    expect(PERMISSIONS["m3.snapshot"]).toEqual(["director"]);
  });
  it("can open the OKR config nav (/okr/director)", () => {
    const cfg = NAV_ITEMS.find((n) => n.href === "/okr/director");
    expect(cfg).toBeDefined();
    expect(canAccessNav(cfg!, "od_viewer")).toBe(true);
    expect(canAccessNav(cfg!, "director")).toBe(true);
    // Not opened to other roles — Head still only proposes.
    expect(canAccessNav(cfg!, "head")).toBe(false);
    expect(canAccessNav(cfg!, "spv")).toBe(false);
  });
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
  it("can view the OKR analysis page nav (/okr)", () => {
    const okr = NAV_ITEMS.find((n) => n.href === "/okr");
    expect(canAccessNav(okr!, "od_viewer")).toBe(true);
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

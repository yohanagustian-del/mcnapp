import { describe, it, expect } from "vitest";
import { ROLES, PERMISSIONS, hasPermission, MANAGEMENT_ROLES, ADS_ROLES, type Role } from "@/lib/rbac";

describe("Phase 5.0 — RBAC foundation", () => {
  it("registers the new internal roles", () => {
    expect(ROLES).toContain("ads_support");
    expect(ROLES).toContain("od_viewer");
  });

  it("does NOT register creator_user as a team role (separate external principal)", () => {
    expect(ROLES).not.toContain("creator_user");
  });

  // M11 §2A.3 — od_viewer must be rejected on EVERY operational mutation endpoint (server-side).
  // Sole exception: 'm11.propose_account_change' writes a proposal row that has no effect until a
  // Director executes it under 'm11.manage_accounts' (which od_viewer does not hold). See
  // od-viewer.test.ts for the full rationale + guard against the exception list growing.
  it("od_viewer holds zero write permissions across the whole matrix, except the no-effect proposal queue", () => {
    for (const perm of Object.keys(PERMISSIONS)) {
      if (perm === "m11.propose_account_change") continue;
      expect(hasPermission(perm as keyof typeof PERMISSIONS, "od_viewer")).toBe(false);
    }
    expect(hasPermission("m11.manage_accounts", "od_viewer")).toBe(false);
  });

  it("director retains full governance/config authority (multi-Director: any Director suffices)", () => {
    for (const perm of ["m10.budget_approve", "m11.manage_accounts", "m12.set_policy", "m12.purge_manual"] as const) {
      expect(hasPermission(perm, "director")).toBe(true);
    }
  });

  // M10 §2.6 — ads_support executes/inputs but cannot create briefs or approve budget.
  it("ads_support can execute + input results but not create briefs nor approve budget", () => {
    expect(hasPermission("m10.brief_execute", "ads_support")).toBe(true);
    expect(hasPermission("m10.result_input", "ads_support")).toBe(true);
    expect(hasPermission("m10.brief_create", "ads_support")).toBe(false);
    expect(hasPermission("m10.budget_approve", "ads_support")).toBe(false);
  });

  it("only Director approves ads budget over cap", () => {
    const approvers = PERMISSIONS["m10.budget_approve"];
    expect(approvers).toEqual(["director"]);
  });

  it("ADS_ROLES scopes Campaign Ops execution to campaign_ops + ads_support", () => {
    expect(ADS_ROLES).toEqual(["campaign_ops", "ads_support"]);
  });

  // M12 §2.7 — retention/purge is Director-only; management does not get it implicitly.
  it("non-director management cannot set retention policy or purge", () => {
    for (const role of MANAGEMENT_ROLES.filter((r) => r !== "director") as Role[]) {
      expect(hasPermission("m12.set_policy", role)).toBe(false);
      expect(hasPermission("m12.purge_manual", role)).toBe(false);
    }
  });
});

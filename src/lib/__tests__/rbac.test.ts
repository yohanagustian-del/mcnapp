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

  // M11 §2A.3 — od_viewer must be rejected on EVERY mutation endpoint (server-side).
  it("od_viewer holds zero write permissions across the whole matrix", () => {
    for (const perm of Object.keys(PERMISSIONS)) {
      expect(hasPermission(perm as keyof typeof PERMISSIONS, "od_viewer")).toBe(false);
    }
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

  // Produk TAP: the catalog itself is open to every role that can reach /products
  // (CM included) — only the "Nama BD" owner column is restricted to BizDev and above.
  it("kolom Nama BD katalog Produk TAP hanya untuk BizDev ke atas", () => {
    for (const role of [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"] as Role[]) {
      expect(hasPermission("products.view_owner_name", role)).toBe(true);
    }
    // Roles that DO see the catalog but must not see who uploaded each row.
    for (const role of ["cm_lead", "cpm", "campaign_ops", "bd_admin"] as Role[]) {
      expect(hasPermission("products.view_owner_name", role)).toBe(false);
      // ...while the catalog page itself stays reachable for them.
      expect(hasPermission("products.upload_master", role)).toBe(true);
    }
  });

  // Hapus katalog Produk TAP (termasuk hapus massal) mengikuti products.edit —
  // dan od_viewer tetap nol seperti seluruh matriks di atas.
  it("hapus Produk TAP dipegang role yang sama dengan yang boleh mengedit", () => {
    expect(PERMISSIONS["products.delete"]).toEqual(PERMISSIONS["products.edit"]);
    expect(hasPermission("products.delete", "campaign_external")).toBe(false);
  });

  // M12 §2.7 — retention/purge is Director-only; management does not get it implicitly.
  it("non-director management cannot set retention policy or purge", () => {
    for (const role of MANAGEMENT_ROLES.filter((r) => r !== "director") as Role[]) {
      expect(hasPermission("m12.set_policy", role)).toBe(false);
      expect(hasPermission("m12.purge_manual", role)).toBe(false);
    }
  });
});

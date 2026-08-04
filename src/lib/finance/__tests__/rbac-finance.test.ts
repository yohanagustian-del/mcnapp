import { describe, it, expect } from "vitest";
import {
  ROLES,
  PERMISSIONS,
  FINANCE_ROLES,
  MANAGEMENT_ROLES,
  NAV_ITEMS,
  canAccessNav,
  hasPermission,
  type Role,
} from "@/lib/rbac";
import { ROLE_TEAM_GROUP } from "@/lib/tim/roles";

/**
 * M14 §RBAC — mekanisme ubah transaksi finance memisahkan TIGA tingkat:
 *   staff finance  : catat + baca, TIDAK boleh mengajukan perubahan
 *   Senior/Lead    : mengajukan perubahan (belum berlaku)
 *   Director       : satu-satunya yang bisa membuat perubahan itu BERLAKU
 * Dites di sini karena pemisahan inilah inti aturannya (CLAUDE.md #9) — kalau satu
 * baris matrix bergeser, gate approval-nya bocor tanpa suara.
 */

describe("M14 — role finance_lead", () => {
  it("terdaftar sebagai role internal", () => {
    expect(ROLES).toContain("finance_lead");
  });

  it("masuk divisi finance (cermin team_group_t di DB)", () => {
    expect(ROLE_TEAM_GROUP.finance_lead).toBe("finance");
  });

  it("FINANCE_ROLES = lead + staff", () => {
    expect(FINANCE_ROLES).toEqual(["finance_lead", "finance"]);
  });
});

describe("M14 — siapa boleh apa", () => {
  it("staff & lead finance sama-sama boleh mencatat transaksi baru (menambah data → auto)", () => {
    expect(hasPermission("finance.transaction_create", "finance")).toBe(true);
    expect(hasPermission("finance.transaction_create", "finance_lead")).toBe(true);
  });

  it("HANYA Senior/Lead Finance (+ management) yang boleh mengajukan perubahan", () => {
    expect(hasPermission("finance.request_change", "finance_lead")).toBe(true);
    expect(hasPermission("finance.request_change", "finance")).toBe(false);
    for (const role of MANAGEMENT_ROLES) {
      expect(hasPermission("finance.request_change", role)).toBe(true);
    }
  });

  it("HANYA Director yang boleh menyetujui perubahan — head/spv pun tidak", () => {
    expect(PERMISSIONS["finance.approve_change"]).toEqual(["director"]);
    for (const role of MANAGEMENT_ROLES.filter((r) => r !== "director")) {
      expect(hasPermission("finance.approve_change", role)).toBe(false);
    }
    expect(hasPermission("finance.approve_change", "finance_lead")).toBe(false);
  });

  it("pengaju bukan pemutus: finance_lead tidak pernah bisa menyetujui pengajuannya sendiri", () => {
    expect(hasPermission("finance.request_change", "finance_lead")).toBe(true);
    expect(hasPermission("finance.approve_change", "finance_lead")).toBe(false);
  });

  it("role di luar finance/management tidak menyentuh transaksi finance", () => {
    const outsiders = ROLES.filter(
      (r) => !FINANCE_ROLES.includes(r as Role) && !MANAGEMENT_ROLES.includes(r as Role),
    );
    for (const role of outsiders) {
      expect(hasPermission("finance.transaction_create", role)).toBe(false);
      expect(hasPermission("finance.request_change", role)).toBe(false);
      expect(hasPermission("finance.approve_change", role)).toBe(false);
    }
  });
});

describe("M14 — akses halaman /finance/transactions", () => {
  const nav = NAV_ITEMS.find((n) => n.href === "/finance/transactions");

  it("terdaftar di nav", () => {
    expect(nav).toBeDefined();
  });

  it("dibuka finance (lead & staff), management, dan bd_admin (invoicing)", () => {
    for (const role of [...FINANCE_ROLES, ...MANAGEMENT_ROLES, "bd_admin" as Role]) {
      expect(canAccessNav(nav!, role)).toBe(true);
    }
  });

  it("ditutup untuk od_viewer & role non-finance (baris transaksi memuat rekening tujuan)", () => {
    for (const role of ["od_viewer", "cpm", "bizdev", "campaign_external", "creator_support"] as Role[]) {
      expect(canAccessNav(nav!, role)).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { canManageProjectParticipants, canUploadProjectPerformance } from "@/lib/m7/access";

describe("canManageProjectParticipants", () => {
  it("allows anyone holding the global m7.manage permission", () => {
    expect(
      canManageProjectParticipants({ hasManagePermission: true, isAssignedManpower: false })
    ).toBe(true);
  });

  it("allows a member assigned as man power on the project without m7.manage", () => {
    expect(
      canManageProjectParticipants({ hasManagePermission: false, isAssignedManpower: true })
    ).toBe(true);
  });

  it("rejects a member who is neither", () => {
    expect(
      canManageProjectParticipants({ hasManagePermission: false, isAssignedManpower: false })
    ).toBe(false);
  });
});

describe("canUploadProjectPerformance", () => {
  it("allows anyone holding the global m7.metrics permission", () => {
    expect(
      canUploadProjectPerformance({ hasMetricsPermission: true, isAssignedManpower: false })
    ).toBe(true);
  });

  // Temuan lapangan 2026-09-17: dua CPM di-assign sebagai man power project #13,
  // sudah bisa mengisi pesertanya, tapi tidak bisa mengunggah data sesi peserta
  // yang sama — role `cpm` tidak ada di m7.metrics.
  it("allows a member assigned as man power on the project without m7.metrics", () => {
    expect(
      canUploadProjectPerformance({ hasMetricsPermission: false, isAssignedManpower: true })
    ).toBe(true);
  });

  it("rejects a member who is neither", () => {
    expect(
      canUploadProjectPerformance({ hasMetricsPermission: false, isAssignedManpower: false })
    ).toBe(false);
  });

  // Kedua hak project ini harus bergerak bersama: "boleh mengisi peserta tapi
  // tidak boleh mengisi datanya" adalah keadaan yang baru saja diperbaiki.
  it("mengikuti hak kelola peserta untuk man power yang sama", () => {
    const facts = { hasManagePermission: false, isAssignedManpower: true };
    expect(canManageProjectParticipants(facts)).toBe(
      canUploadProjectPerformance({ hasMetricsPermission: false, isAssignedManpower: true })
    );
  });
});

import { describe, expect, it } from "vitest";
import { canManageProjectParticipants } from "@/lib/m7/access";

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

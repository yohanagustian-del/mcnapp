import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission, PERMISSIONS, type Role, type TeamMember } from "./rbac-constants";

// Client-safe constants/types (ROLES, MANAGEMENT_ROLES, NAV_ITEMS, PERMISSIONS, hasPermission,
// canAccessNav, …) live in rbac-constants.ts so "use client" components can import them without
// pulling these server-only auth helpers (next/headers via supabase/server) into their bundle.
// Re-exported here so every existing `from "@/lib/rbac"` import keeps working unchanged.
export * from "./rbac-constants";

/**
 * Loads the authenticated team member or redirects to /login.
 * Every portal page/layout and server action goes through this (server-enforced RBAC).
 */
export async function requireMember(): Promise<TeamMember> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, email, role, team_group, platform_segment, active")
    .eq("id", user.id)
    .single();

  if (!member || !member.active) {
    // Not an active team member — check if this auth user is actually a creator
    // hitting an internal page, so they bounce to their own portal instead of
    // seeing a "not registered" error. Lookup only runs in this failure path.
    const admin = createAdminClient();
    const { data: creatorUser } = await admin
      .from("creator_users")
      .select("id")
      .eq("auth_uid", user.id)
      .maybeSingle();

    if (creatorUser) redirect("/portal");
    redirect("/login?error=no_member");
  }
  return member as TeamMember;
}

/** Guard for server actions: authenticated member + permission check. Throws on violation. */
export async function requirePermission(permission: keyof typeof PERMISSIONS): Promise<TeamMember> {
  const member = await requireMember();
  if (!hasPermission(permission, member.role)) {
    throw new Error(`Akses ditolak: role ${member.role} tidak punya izin ${String(permission)}`);
  }
  return member;
}

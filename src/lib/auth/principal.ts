import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/auth/password-reset";

/**
 * A login that is allowed to hold a password on this platform: an active
 * team_member (internal portal) or an activated creator_user (portal kreator).
 *
 * `auditActorId` / `auditActorLabel` follow the writeAudit contract (lib/audit.ts):
 * team_members go in actor_id, external principals in actor_label.
 */
export interface EligiblePrincipal {
  kind: "team_member" | "creator_user";
  authUid: string;
  auditActorId: string | null;
  auditActorLabel: string | null;
}

/**
 * Resolve an email to an eligible principal, or null.
 *
 * Service-role lookup: the caller is unauthenticated (forgot-password), so RLS
 * would hide everything. Deliberately excludes deactivated team members and
 * suspended/never-activated creators — a disabled account must not be able to
 * mint itself a new password. Returning null is never surfaced to the user.
 */
export async function findEligiblePrincipalByEmail(
  rawEmail: string
): Promise<EligiblePrincipal | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  const admin = createAdminClient();

  const { data: members } = await admin
    .from("team_members")
    .select("id, active")
    .eq("email", email)
    .limit(1);

  const member = members?.[0];
  if (member) {
    if (!member.active) return null;
    return {
      kind: "team_member",
      authUid: member.id,
      auditActorId: member.id,
      auditActorLabel: null,
    };
  }

  const { data: creatorUsers } = await admin
    .from("creator_users")
    .select("auth_uid, creator_id, status")
    .eq("email", email)
    .limit(1);

  const creatorUser = creatorUsers?.[0];
  if (creatorUser?.auth_uid && creatorUser.status === "active") {
    return {
      kind: "creator_user",
      authUid: creatorUser.auth_uid,
      auditActorId: null,
      auditActorLabel: `creator_user:${creatorUser.creator_id}`,
    };
  }

  return null;
}

/** Same check keyed on the auth user id, for the completion step. */
export async function findEligiblePrincipalByAuthUid(
  authUid: string
): Promise<EligiblePrincipal | null> {
  const admin = createAdminClient();

  const { data: member } = await admin
    .from("team_members")
    .select("id, active")
    .eq("id", authUid)
    .maybeSingle();

  if (member) {
    if (!member.active) return null;
    return {
      kind: "team_member",
      authUid: member.id,
      auditActorId: member.id,
      auditActorLabel: null,
    };
  }

  const { data: creatorUser } = await admin
    .from("creator_users")
    .select("auth_uid, creator_id, status")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (creatorUser?.auth_uid && creatorUser.status === "active") {
    return {
      kind: "creator_user",
      authUid: creatorUser.auth_uid,
      auditActorId: null,
      auditActorLabel: `creator_user:${creatorUser.creator_id}`,
    };
  }

  return null;
}

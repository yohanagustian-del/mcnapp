import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * M9 external principal guard. Creators authenticate via their own Supabase Auth session
 * (creator_users.auth_uid). This resolves that session to the owning creator and returns
 * the creator_id used to scope EVERY portal query. Isolation is enforced twice: here
 * (server filters by this creator_id) and by the self-only RLS in 0011 as defense-in-depth.
 */
export interface CreatorSession {
  creatorUserId: string;
  creatorId: string;
  email: string;
  status: "invited" | "active" | "suspended";
}

export async function requireCreator(): Promise<CreatorSession> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?portal=creator");

  // Look up via service role: creator_users has self-only RLS keyed on the (not-yet-set) claim.
  const admin = createAdminClient();
  const { data: cu } = await admin
    .from("creator_users")
    .select("id, creator_id, email, status")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (!cu || cu.status !== "active") {
    // Not an active creator — check if this auth user is actually a team member
    // hitting a portal page, so they bounce to the internal dashboard instead of
    // seeing a "not registered as creator" error. Lookup only runs in this failure path.
    const { data: teamMember } = await admin
      .from("team_members")
      .select("id, active")
      .eq("id", user.id)
      .maybeSingle();

    if (teamMember && teamMember.active) redirect("/dashboard");
    redirect("/login?portal=creator&error=no_creator");
  }
  return { creatorUserId: cu.id, creatorId: cu.creator_id, email: cu.email, status: cu.status };
}

/** Audit actor label for creator mutations (§5 — 'creator_user:CRT-xxxxx'). */
export function creatorActor(creatorId: string): string {
  return `creator_user:${creatorId}`;
}

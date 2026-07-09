"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) redirect("/login?error=missing");

  const supabase = await createClient();
  const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=invalid");

  // Determine portal: check if creator_user or team_member
  const admin = createAdminClient();
  const userId = authData.user!.id;

  // Check creator_users first (creator portal)
  const { data: creatorUser } = await admin
    .from("creator_users")
    .select("id")
    .eq("auth_uid", userId)
    .maybeSingle();

  if (creatorUser) {
    redirect("/portal");
  }

  // Check team_members (internal portal)
  const { data: teamMember } = await admin
    .from("team_members")
    .select("id, active")
    .eq("id", userId)
    .maybeSingle();

  if (teamMember && teamMember.active) {
    redirect("/dashboard");
  }

  // User exists in auth but not registered in either portal
  redirect("/login?error=no_member");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

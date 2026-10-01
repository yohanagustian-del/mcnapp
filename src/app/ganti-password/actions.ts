"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { creatorActor } from "@/lib/m9/creator-auth";
import { validateNewPassword } from "@/lib/auth/password-reset";

export type ForcedPasswordState = { ok: boolean; error?: string } | null;

/**
 * Forced first password for a creator who logged in with a staff-issued temporary
 * password (invite or Reset Password — lib/portal/invite.ts, migration 0085). The
 * session itself is the proof of the temporary password, so no "current password"
 * field. Clears must_change_password and activates an invited account. Self-service,
 * harms no one → `auto` audit, password never logged (CLAUDE.md #2).
 */
export async function setOwnPortalPassword(
  _prev: ForcedPasswordState,
  formData: FormData
): Promise<ForcedPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  const invalid = validateNewPassword(password, confirm);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?portal=creator");

  const admin = createAdminClient();
  const { data: cu } = await admin
    .from("creator_users")
    .select("id, creator_id, status, must_change_password, activated_at")
    .eq("auth_uid", user.id)
    .maybeSingle();
  if (!cu || cu.status === "suspended") redirect("/login?portal=creator&error=no_creator");
  if (!cu.must_change_password) redirect("/portal");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") {
      return { ok: false, error: "Password baru tidak boleh sama dengan password sementara." };
    }
    return { ok: false, error: `Gagal menyimpan password: ${error.message}` };
  }

  const { error: updError } = await admin
    .from("creator_users")
    .update({
      must_change_password: false,
      temp_password_set_at: null,
      status: "active",
      activated_at: cu.activated_at ?? new Date().toISOString(),
    })
    .eq("id", cu.id);
  if (updError) return { ok: false, error: `Gagal mengaktifkan akun: ${updError.message}` };

  await writeAudit({
    actorLabel: creatorActor(cu.creator_id), action: "m9.portal_password_set",
    entityType: "creator_users", entityId: cu.id,
    before: { status: cu.status, must_change_password: true },
    after: { status: "active", must_change_password: false }, type: "auto",
  });

  redirect("/portal");
}

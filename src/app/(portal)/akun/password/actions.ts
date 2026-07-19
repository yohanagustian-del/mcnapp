"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireMember } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

export interface ChangePasswordState {
  ok: boolean;
  message: string;
}

const MIN_LENGTH = 8;

/**
 * Self-service password change for a logged-in team member.
 * Verifies the current password on a throwaway (non-persisting) client so the
 * active session cookies stay intact, then updates the password on the
 * request-scoped session client. Every change is written to audit_logs.
 */
export async function changePassword(
  _prev: ChangePasswordState | null,
  formData: FormData
): Promise<ChangePasswordState> {
  const member = await requireMember();

  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { ok: false, message: "Semua kolom wajib diisi." };
  }
  if (newPassword.length < MIN_LENGTH) {
    return { ok: false, message: `Password baru minimal ${MIN_LENGTH} karakter.` };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, message: "Konfirmasi password baru tidak cocok." };
  }
  if (newPassword === currentPassword) {
    return { ok: false, message: "Password baru harus berbeda dari password lama." };
  }

  // Verify the current password without disturbing the active session:
  // sign in on a throwaway client that never persists cookies/tokens.
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: member.email,
    password: currentPassword,
  });
  if (verifyError) {
    return { ok: false, message: "Password lama salah." };
  }

  // Update on the request-scoped client, which carries the user's own session.
  const supabase = await createClient();
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { ok: false, message: `Gagal mengubah password: ${updateError.message}` };
  }

  await writeAudit({
    actorId: member.id,
    action: "team_member.password_change",
    entityType: "team_members",
    entityId: member.id,
    type: "auto",
  });

  return {
    ok: true,
    message: "Password berhasil diubah. Gunakan password baru pada login berikutnya.",
  };
}

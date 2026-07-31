"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

/** State untuk form ganti password (useActionState). */
export type ChangePasswordState = { ok: boolean; error?: string } | null;

/**
 * Ganti password self-service — tersedia untuk kedua principal (team_members
 * maupun creator_users), dipicu manual oleh user sendiri lewat sidebar.
 * Aksi ini tidak merugikan perusahaan (self-service, bukan dari data platform)
 * → auto berlaku, tetap tercatat di audit_logs (CLAUDE.md #2).
 *
 * Password TIDAK PERNAH ditulis ke audit_logs (before/after), hanya penanda
 * bahwa perubahan terjadi.
 */
export async function changePassword(
  prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi berakhir. Silakan login ulang." };

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { ok: false, error: "Semua field wajib diisi." };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "Password baru minimal 8 karakter." };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "Konfirmasi password baru tidak cocok." };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: "Password baru tidak boleh sama dengan password saat ini." };
  }

  // Verifikasi password saat ini dengan re-sign-in (Supabase Auth tidak punya
  // endpoint verifikasi password terpisah).
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword,
  });
  if (signInError) return { ok: false, error: "Password saat ini salah." };

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { ok: false, error: "Gagal mengubah password: " + updateError.message };
  }

  // Tentukan actor untuk audit_logs: team_member (internal) atau creator_user (portal kreator).
  const admin = createAdminClient();
  const { data: teamMember } = await admin
    .from("team_members")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (teamMember) {
    // Password sementara dari Director sudah diganti sendiri oleh user → gerbang dibuka.
    await admin.from("team_members").update({ must_change_password: false }).eq("id", user.id);
    await writeAudit({
      actorId: user.id,
      action: "password_change",
      entityType: "auth_user",
      entityId: user.id,
      before: null,
      after: { changed: true },
      type: "auto",
    });
  } else {
    const { data: creatorUser } = await admin
      .from("creator_users")
      .select("creator_id")
      .eq("auth_uid", user.id)
      .maybeSingle();

    await writeAudit({
      actorId: null,
      actorLabel: creatorUser ? `creator_user:${creatorUser.creator_id}` : null,
      action: "password_change",
      entityType: "auth_user",
      entityId: user.id,
      before: null,
      after: { changed: true },
      type: "auto",
    });
  }

  return { ok: true };
}

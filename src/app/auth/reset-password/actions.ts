"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { findEligiblePrincipalByAuthUid } from "@/lib/auth/principal";
import { validateNewPassword } from "@/lib/auth/password-reset";

/** State untuk form password baru (useActionState). */
export type ResetPasswordState = { ok: boolean; error?: string } | null;

/**
 * Simpan password baru memakai sesi recovery dari tautan email.
 *
 * Bukti kepemilikan = tautan email, jadi tidak ada verifikasi password lama
 * (beda dengan changePassword di /account). Kelayakan akun dicek ulang di sini:
 * sesi recovery yang valid tetap ditolak kalau team_member-nya sudah nonaktif.
 *
 * Password TIDAK PERNAH ditulis ke audit_logs — hanya penanda perubahan.
 * Sukses → semua sesi dicabut (scope global) supaya sesi lama dari perangkat
 * lain ikut mati, lalu user login ulang dengan password baru.
 */
export async function resetPassword(
  prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const invalid = validateNewPassword(newPassword, confirmPassword);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "Sesi reset sudah kedaluwarsa. Minta tautan baru dari halaman Lupa Password.",
    };
  }

  const principal = await findEligiblePrincipalByAuthUid(user.id);
  if (!principal) {
    return {
      ok: false,
      error: "Akun tidak terdaftar sebagai anggota tim aktif. Hubungi Management.",
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { ok: false, error: "Gagal menyimpan password: " + updateError.message };
  }

  await writeAudit({
    actorId: principal.auditActorId,
    actorLabel: principal.auditActorLabel,
    action: "password_reset_completed",
    entityType: "auth_user",
    entityId: user.id,
    before: null,
    after: { changed: true, via: "email_recovery_link", principal: principal.kind },
    type: "auto",
  });

  await supabase.auth.signOut({ scope: "global" });

  redirect("/login?success=reset");
}

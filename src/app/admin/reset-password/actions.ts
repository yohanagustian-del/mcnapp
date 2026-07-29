"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

/**
 * Admin-only action untuk reset password user ke temporary password.
 * Requires: management role (director/head/spv)
 *
 * Use case: User lupa password atau user baru perlu diakses.
 * Password TIDAK disimpan ke audit_logs (hanya penanda bahwa reset terjadi).
 * Gunakan untuk production: safe, auditible, RLS-enforced.
 */
export async function resetUserPassword(email: string, tempPassword: string) {
  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return { ok: false, error: "Sesi berakhir. Silakan login ulang." };
  }

  // Check if current user is management (director/head/spv)
  const { data: member } = await supabase
    .from("team_members")
    .select("role")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (!member || !["director", "head", "spv"].includes(member.role)) {
    return {
      ok: false,
      error: "Hanya management yang bisa reset password user.",
    };
  }

  if (!email || !tempPassword) {
    return { ok: false, error: "Email dan temporary password wajib diisi." };
  }

  if (tempPassword.length < 8) {
    return {
      ok: false,
      error: "Temporary password minimal 8 karakter.",
    };
  }

  // Use admin client untuk reset password di auth.users
  const admin = createAdminClient();

  // Cari user by email di Supabase Auth
  const { data: userData, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    return { ok: false, error: "Gagal mengakses user: " + listError.message };
  }

  const targetUser = userData.users.find((u) => u.email === email);
  if (!targetUser) {
    return { ok: false, error: `User dengan email ${email} tidak ditemukan.` };
  }

  // Reset password
  const { error: updateError } = await admin.auth.admin.updateUserById(
    targetUser.id,
    { password: tempPassword }
  );

  if (updateError) {
    return {
      ok: false,
      error: "Gagal reset password: " + updateError.message,
    };
  }

  // Catat ke audit_logs
  const { data: targetMember } = await admin
    .from("team_members")
    .select("id, name")
    .eq("id", targetUser.id)
    .maybeSingle();

  await writeAudit({
    actorId: currentUser.id,
    action: "password_reset_by_admin",
    entityType: "auth_user",
    entityId: targetUser.id,
    before: null,
    after: {
      reset: true,
      targetEmail: email,
      targetName: targetMember?.name || "N/A",
    },
    type: "auto",
  });

  return {
    ok: true,
    message: `Password user ${email} berhasil direset ke: ${tempPassword}`,
  };
}

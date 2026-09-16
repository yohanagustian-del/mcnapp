"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { creatorActor } from "@/lib/m9/creator-auth";
import { validateNewPassword } from "@/lib/auth/password-reset";

/**
 * Konsumsi `creator_users.invite_token` (PRD R36/PR-18) — bagian yang tadinya
 * hilang: `invitePortalAccount` (M7 v2) sudah membuat baris `creator_users`
 * berstatus 'invited' + token sejak migrasi 0011, tapi repo belum pernah punya
 * halaman untuk menukarnya jadi akun aktif. Ini halaman + action itu.
 *
 * Alur: token dicek ulang di sini (server tidak percaya validasi di halaman),
 * auth user dibuat via admin client (service role — creator belum punya sesi
 * apa pun), lalu `creator_users` di-set aktif dan token DIHAPUS (satu kali
 * pakai). Sesi baru ditulis lewat client SSR biasa (bukan admin) supaya
 * cookie-nya benar, persis pola `login()` di src/app/login/actions.ts.
 */
export type ActivateAccountState = { ok: boolean; error?: string } | null;

export async function activatePortalAccount(
  prevState: ActivateAccountState,
  formData: FormData
): Promise<ActivateAccountState> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  if (!token) return { ok: false, error: "Token undangan tidak ditemukan." };

  const invalid = validateNewPassword(password, confirmPassword);
  if (invalid) return { ok: false, error: invalid };

  const admin = createAdminClient();
  const { data: cu } = await admin
    .from("creator_users")
    .select("id, creator_id, email, status")
    .eq("invite_token", token)
    .maybeSingle();
  if (!cu) return { ok: false, error: "Link aktivasi tidak valid." };
  if (cu.status !== "invited") {
    return { ok: false, error: "Link ini sudah pernah dipakai atau akun sudah nonaktif." };
  }

  let userId: string;
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: cu.email,
    password,
    email_confirm: true,
  });
  if (authError) {
    // Edge case: an auth user with this email already exists (e.g. re-invited
    // after a partial earlier attempt) — reuse it and set the new password,
    // rather than failing outright (same defensive pattern as team bulk-import).
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = list?.users.find((u) => u.email?.toLowerCase() === cu.email.toLowerCase());
    if (!match) return { ok: false, error: `Gagal membuat akun: ${authError.message}` };
    userId = match.id;
    await admin.auth.admin.updateUserById(userId, { password });
  } else {
    userId = created.user.id;
  }

  const { error: updateError } = await admin
    .from("creator_users")
    .update({ auth_uid: userId, status: "active", activated_at: new Date().toISOString(), invite_token: null })
    .eq("id", cu.id);
  if (updateError) return { ok: false, error: `Gagal mengaktifkan akun: ${updateError.message}` };

  await writeAudit({
    actorLabel: creatorActor(cu.creator_id), action: "m9.portal_activate",
    entityType: "creator_users", entityId: cu.id,
    before: { status: "invited" }, after: { status: "active" }, type: "auto",
  });

  // Sign in with the SSR client (not the admin one) so the session lands in cookies.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: cu.email, password });
  if (signInError) redirect("/login?portal=creator&success=activated");

  redirect("/portal");
}

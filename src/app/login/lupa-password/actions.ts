"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { findEligiblePrincipalByEmail } from "@/lib/auth/principal";
import { resolveOrigin } from "@/lib/auth/origin";
import {
  buildResetRedirectUrl,
  isValidEmail,
  normalizeEmail,
} from "@/lib/auth/password-reset";

/** State untuk form lupa password (useActionState). */
export type ForgotPasswordState = { ok: boolean; error?: string } | null;

/**
 * Kirim email reset password (self-service, tanpa login).
 *
 * Aksi ini tidak merugikan perusahaan → auto berlaku, tetap tercatat di
 * audit_logs (CLAUDE.md #2). Deterministik: tidak ada LLM di jalur ini.
 *
 * Balasan SELALU generik ("cek inbox"), baik email terdaftar maupun tidak —
 * membedakan keduanya akan membocorkan daftar email internal ke publik.
 * Akun nonaktif (mis. test QA yang sudah dimatikan) sengaja tidak dikirimi
 * email sama sekali.
 */
export async function requestPasswordReset(
  prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = normalizeEmail(formData.get("email"));

  if (!isValidEmail(email)) {
    return { ok: false, error: "Format email tidak valid." };
  }

  const principal = await findEligiblePrincipalByEmail(email);

  if (principal) {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildResetRedirectUrl(await resolveOrigin()),
    });

    if (error) {
      // Swallowed on purpose: surfacing "rate limited" only for real accounts
      // would turn this form into an email-existence oracle. Operators see it
      // in the server log instead.
      console.error("resetPasswordForEmail failed:", error.message);
      return { ok: true };
    }

    await writeAudit({
      actorId: principal.auditActorId,
      actorLabel: principal.auditActorLabel,
      action: "password_reset_requested",
      entityType: "auth_user",
      entityId: principal.authUid,
      before: null,
      after: { channel: "email", principal: principal.kind },
      type: "auto",
    });
  }

  return { ok: true };
}

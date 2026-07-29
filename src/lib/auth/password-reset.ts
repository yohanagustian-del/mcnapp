/**
 * Pure helpers shared by the "lupa password" (forgot password) flow.
 *
 * Kept free of Supabase/Next imports so both the request action
 * (/login/lupa-password) and the completion action (/auth/reset-password)
 * validate identically, and so the rules are unit-testable.
 */

/** Minimum password length — same rule as the self-service change-password form. */
export const MIN_PASSWORD_LENGTH = 8;

/** Path the recovery email link lands on before redirecting to the form. */
export const RESET_CALLBACK_PATH = "/auth/confirm";

/** Page holding the "set a new password" form. */
export const RESET_FORM_PATH = "/auth/reset-password";

/** Lowercase + trim so lookups match how emails are stored. */
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Shape check only — existence is never confirmed to the caller (see
 * requestPasswordReset), so this just rejects obvious typos client-side.
 */
export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Returns an Indonesian error message, or null when the new password is acceptable.
 * The recovery flow has no "current password" to compare against — the emailed
 * link is the proof of ownership.
 */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password || !confirm) return "Password baru dan konfirmasi wajib diisi.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password baru minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  }
  if (password !== confirm) return "Konfirmasi password baru tidak cocok.";
  return null;
}

/** Absolute URL Supabase sends the recovery link to. */
export function buildResetRedirectUrl(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${RESET_CALLBACK_PATH}?next=${encodeURIComponent(RESET_FORM_PATH)}`;
}

/**
 * Guard for the `next` query param on the callback: only same-site absolute
 * paths are followed, so a crafted link cannot bounce a freshly authenticated
 * recovery session to an external host.
 */
export function safeNextPath(next: string | null): string {
  if (!next) return RESET_FORM_PATH;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return RESET_FORM_PATH;
  }
  return next;
}

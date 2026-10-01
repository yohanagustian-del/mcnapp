/**
 * What staff send a creator after an invite or Reset Password (lib/portal/invite.ts).
 * Client-safe (no Node imports): rendered by <PortalInviteButton>.
 */
export interface PortalCredentials {
  creatorName: string;
  loginUrl: string;
  email: string;
  password: string;
}

/** Ready-to-paste WhatsApp message for the creator (UI copy, Bahasa Indonesia). */
export function portalCredentialsMessage(c: PortalCredentials): string {
  return [
    `Halo ${c.creatorName}! Akun Portal Kreator MCN MEA kamu sudah siap.`,
    "",
    `Login: ${c.loginUrl}`,
    `Email: ${c.email}`,
    `Password sementara: ${c.password}`,
    "",
    "Setelah login, kamu akan diminta membuat password baru. Jangan bagikan password ini ke siapa pun.",
  ].join("\n");
}

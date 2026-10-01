import { randomInt } from "crypto";

/**
 * Creator Portal temporary passwords (user decision 2026-10-01, option A+B):
 * every invite and every staff "Reset Password" mints a UNIQUE random password
 * that is shown once to staff (sent to the creator over WA) and must be replaced
 * on first login. There is deliberately no shared default password: one known
 * password for every creator would let anyone who knows a creator's email log
 * into that creator's account.
 *
 * Pure (crypto only) so the format and the access rule are unit-tested.
 */

// No 0/O, 1/I/L — the creator types this from a WA message.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP = 4;

/** "Mcn-7KQ4-X29P": 8 random symbols from a 31-char alphabet (~40 bits), ≥ MIN_PASSWORD_LENGTH. */
export function generateTempPassword(): string {
  const group = () => Array.from({ length: GROUP }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `Mcn-${group()}-${group()}`;
}

export type CreatorPortalAccess = "allow" | "change_password" | "reject";

/**
 * What requireCreator() does with a session's creator_users row:
 *  - temp password still in use (invited or reset) → must change it first;
 *  - active → portal;
 *  - suspended, never set up, or a legacy invite never activated → rejected.
 */
export function creatorPortalAccess(
  cu: { status: string; must_change_password?: boolean | null } | null
): CreatorPortalAccess {
  if (!cu || cu.status === "suspended") return "reject";
  if (cu.must_change_password && (cu.status === "invited" || cu.status === "active")) return "change_password";
  return cu.status === "active" ? "allow" : "reject";
}

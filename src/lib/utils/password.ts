/**
 * Temporary password generation utils.
 * Format: Aa1_XXXXXX (memenuhi Supabase Auth: min 8 chars, uppercase, lowercase, number, special char)
 */

export function generateTemporaryPassword(): string {
  // Generate 6 random alphanumeric chars
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Format: Aa1_ + random (guaranteed uppercase, lowercase, digit, special)
  return `Aa1_${random}`;
}

/**
 * Validate temporary password format (safety check).
 */
export function isValidTemporaryPassword(pwd: string): boolean {
  return pwd.length >= 8 && /[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /[0-9]/.test(pwd) && /[_!@#$%^&*]/.test(pwd);
}

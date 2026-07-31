import { randomInt } from "node:crypto";

/**
 * Generator password sementara — SERVER ONLY (memakai node:crypto), jadi sengaja
 * dipisah dari member-admin.ts yang ikut dipakai komponen klien.
 *
 * Password hasil fungsi ini ditampilkan SEKALI ke Director dan tidak pernah disimpan
 * di DB maupun audit_logs. User wajib menggantinya saat login pertama
 * (team_members.must_change_password).
 */

// Karakter ambigu (0/O, 1/l/I) dibuang supaya password aman didikte lisan.
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const SYMBOL = "!@#$%*?";

export const TEMP_PASSWORD_CHARSET = LOWER + UPPER + DIGIT + SYMBOL;
export const TEMP_PASSWORD_LENGTH = 14;

export function generateTempPassword(): string {
  // Satu karakter dijamin dari tiap kelas, sisanya acak, lalu diacak posisinya.
  const chars = [
    LOWER[randomInt(LOWER.length)],
    UPPER[randomInt(UPPER.length)],
    DIGIT[randomInt(DIGIT.length)],
    SYMBOL[randomInt(SYMBOL.length)],
  ];
  while (chars.length < TEMP_PASSWORD_LENGTH) {
    chars.push(TEMP_PASSWORD_CHARSET[randomInt(TEMP_PASSWORD_CHARSET.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

import { randomBytes } from "crypto";

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no O/I ambiguity
const LOWER = "abcdefghjkmnpqrstuvwxyz"; // no o/i/l ambiguity
const DIGIT = "23456789"; // no 0/1
const SYMBOL = "!@#$%&*";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

function randomChar(charset: string): string {
  return charset[randomBytes(1)[0] % charset.length];
}

/**
 * Password sementara untuk akun baru (bulk upload & tambah akun satuan tab Tim).
 * 12 karakter, dijamin punya huruf besar/kecil/angka/simbol, tanpa glyph ambigu.
 * Ditampilkan SEKALI ke pembuat akun — tidak disimpan di DB (Supabase Auth yang
 * menyimpan hash-nya), jadi harus segera diteruskan ke anggota tim.
 */
export function generateTempPassword(): string {
  const chars = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGIT), randomChar(SYMBOL)];
  for (let i = 0; i < 8; i++) chars.push(randomChar(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

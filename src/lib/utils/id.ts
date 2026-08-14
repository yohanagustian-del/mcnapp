import { randomBytes } from "crypto";

export type EntityPrefix = "CRT" | "DEAL" | "LNK" | "REQ" | "PRD";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L ambiguity

/**
 * Centralized entity ID generator (text PK): CRT-xxxxx, DEAL-xxxxx, LNK-xxxxx,
 * REQ-xxxxx (request penugasan CM), PRD-xxxxx (kartu produk yang didaftarkan
 * tanpa Product ID platform).
 * 5 chars from a 31-char alphabet ≈ 28M combinations; callers must retry on
 * unique-constraint violation (see insertWithGeneratedId).
 */
export function genId(prefix: EntityPrefix): string {
  const bytes = randomBytes(5);
  let suffix = "";
  for (let i = 0; i < 5; i++) suffix += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${suffix}`;
}

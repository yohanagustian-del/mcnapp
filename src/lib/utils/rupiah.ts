/**
 * Tolerant Rupiah parser for mixed legacy formats (CLAUDE.md #7):
 *  - "Rp1,075,484,867"  → comma = thousands
 *  - "Rp4.131.512.642"  → dot = thousands
 *  - "Rp1.234.567,89"   → dot = thousands, comma = decimal
 *  - "1234567"          → plain number
 * Returns null for empty/unparseable input (caller flags for review, never crash).
 */
export function parseRupiah(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = raw.trim();
  if (s === "" || s === "-") return null;

  let negative = false;
  if (s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"))) {
    negative = true;
    s = s.replace(/^[-(]+|\)+$/g, "");
  }
  s = s.replace(/rp\.?/gi, "").replace(/\s/g, "");
  if (s === "") return null;
  if (!/^[\d.,]+$/.test(s)) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  let normalized: string;
  if (hasDot && hasComma) {
    // Last separator wins as decimal; the other is thousands.
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = s.split(sep);
    const groupedAsThousands =
      parts.length > 1 &&
      parts.slice(1).every((p) => p.length === 3) &&
      parts[0].length >= 1 &&
      parts[0].length <= 3;
    if (groupedAsThousands) {
      normalized = parts.join("");
    } else if (parts.length === 2 && parts[1].length <= 2) {
      // single separator with 1-2 trailing digits → decimal
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      return null;
    }
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

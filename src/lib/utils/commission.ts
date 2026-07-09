export interface ParsedCommission {
  /** Single rate or lower bound of a range, in percent. */
  min: number;
  /** Equal to min unless the raw value was a range like "5-7%". */
  max: number;
  /** True when the raw value was a range → store raw + flag for review. */
  isRange: boolean;
}

/**
 * Tolerant commission parser for dirty legacy values (CLAUDE.md #7):
 *  "10%" → {10,10}; "5-7%" → {5,7,isRange}; "not found"/"error"/"not yet"/"" → null.
 * Never throws; null means unparseable → caller stores raw + review flag.
 */
export function parseCommission(raw: string | number | null | undefined): ParsedCommission | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { min: raw, max: raw, isRange: false } : null;
  }
  const s = raw.trim().toLowerCase();
  if (s === "") return null;

  const range = s.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*%?$/);
  if (range) {
    const min = Number(range[1].replace(",", "."));
    const max = Number(range[2].replace(",", "."));
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min: Math.min(min, max), max: Math.max(min, max), isRange: true };
  }

  const single = s.match(/^(\d+(?:[.,]\d+)?)\s*%?$/);
  if (single) {
    const v = Number(single[1].replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100) return null;
    return { min: v, max: v, isRange: false };
  }

  return null; // "not found", "error", "not yet", free text, ...
}

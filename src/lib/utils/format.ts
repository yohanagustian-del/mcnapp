/**
 * Display formatters shared by server and client components (pure, no imports).
 * Parsing lives in ./rupiah — this module only renders numbers for the UI.
 */

/** Full Rupiah, e.g. Rp1.075.484.867. */
export function rupiah(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
}

/** Fraction → percent, no decimals (0.153 → 15%). */
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${(Number(n) * 100).toFixed(0)}%`;
}

/** Fraction → percent, 1 decimal (0.1534 → 15,3% style but dot-decimal like the rest of the UI). */
export function pct1(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${(Number(n) * 100).toFixed(1)}%`;
}

/** Compact Rupiah for dense cells, e.g. Rp121,2jt / Rp850rb / Rp1,4M. */
export function rupiahRingkas(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `Rp${(v / 1_000_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000_000) return `Rp${(v / 1_000_000).toFixed(1).replace(".", ",")}jt`;
  if (abs >= 1_000) return `Rp${(v / 1_000).toFixed(0)}rb`;
  return `Rp${Math.round(v).toLocaleString("id-ID")}`;
}

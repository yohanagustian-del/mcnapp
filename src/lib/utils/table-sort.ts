/**
 * Pure comparators behind the sortable table headers (src/components/table-controls.tsx).
 *
 * Kept out of the client component so the ordering rules are unit-testable
 * without React: sorting a table is deterministic UI logic, not rendering.
 */

export type SortDir = "asc" | "desc";

/** Nilai yang bisa diurutkan; null/undefined/NaN = "tidak ada data". */
export type SortValue = string | number | null | undefined;

function isMissing(v: SortValue): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

/**
 * Compares two cell values for a given direction. Missing values (null, undefined,
 * empty string, NaN) always sink to the BOTTOM — in both directions — so flipping
 * asc/desc never floats a column of "—" above real numbers.
 */
export function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b), "id", { numeric: true, sensitivity: "base" });

  return dir === "asc" ? cmp : -cmp;
}

/**
 * Stable sort by one accessor. Returns a new array; ties keep their input order
 * (Array.prototype.sort is stable in ES2019+, and the index fallback below makes
 * that explicit for readers).
 */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => compareSortValues(value(x.row), value(y.row), dir) || x.index - y.index)
    .map((entry) => entry.row);
}

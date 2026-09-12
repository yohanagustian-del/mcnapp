/**
 * CSV builder for the PX-M1 Coverage tab export (pattern: builder string in
 * server + Blob in client, same as src/lib/m4/leak-export.ts buildSummaryCsv +
 * src/app/(portal)/link-leakage/download-csv-button.tsx — no generic exportCsv
 * util exists in this repo, so this follows the established per-module pattern
 * rather than inventing a shared one).
 */

export interface CoverageRow {
  level2_category: string;
  price_segment: string;
  creator_count: number;
  total_slots_available: number;
  total_proven_gmv: number;
  status: string;
}

/** RFC 4180 field escape (quote + double inner quotes) — same rule as leak-export.ts. */
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  // BOM so Excel (ID locale) opens UTF-8 names correctly.
  return `﻿${lines.join("\r\n")}`;
}

export function buildCoverageCsv(rows: CoverageRow[]): string {
  return toCsv(
    ["level2_category", "price_segment", "creator_count", "total_slots_available", "total_proven_gmv", "status"],
    rows.map((r) => [
      r.level2_category, r.price_segment, r.creator_count, r.total_slots_available,
      Math.round(r.total_proven_gmv), r.status,
    ])
  );
}

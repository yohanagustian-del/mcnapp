import Papa from "papaparse";

export interface CsvParseResult {
  rows: Record<string, string>[];
  errors: string[];
}

/** Parse CSV text with normalized (trimmed, lowercased, snake_cased) headers. */
export function parseCsv(text: string): CsvParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  return {
    rows: result.data,
    errors: result.errors.map((e) => `Baris ${e.row ?? "?"}: ${e.message}`),
  };
}

/** Platform exports prepend a totals row: "Summary" (EN) / "Ringkasan" (ID). */
export function isSummaryRow(row: Record<string, string>): boolean {
  return Object.values(row).some(
    (v) => typeof v === "string" && ["summary", "ringkasan"].includes(v.trim().toLowerCase())
  );
}

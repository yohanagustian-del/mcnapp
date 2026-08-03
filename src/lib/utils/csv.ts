import Papa from "papaparse";

export interface CsvParseResult {
  rows: Record<string, string>[];
  errors: string[];
}

/**
 * Header sheet/CSV → kunci baris: trim, huruf kecil, spasi → "_", dan penanda
 * kolom wajib "*" DIBUANG.
 *
 * Penanda "*" dibuang di sini supaya template yang menulis "Username*" / "CM*"
 * tetap terbaca oleh pembaca yang mencocokkan kunci persis (`pick()` di
 * platform-csv). Tanpa ini, "Username*" jadi kunci "username*" dan
 * `pick(raw, ["username"])` selalu mengembalikan string kosong — kolomnya
 * seolah-olah tidak ada di file padahal terisi.
 *
 * Hanya "*" yang dibuang, bukan seluruh tanda baca: header seperti
 * "gmv_l30d_(otomatis)" masih dipakai apa adanya oleh `pickPrefix`.
 */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_").replace(/\*/g, "");
}

/** Parse CSV text with normalized (trimmed, lowercased, snake_cased) headers. */
export function parseCsv(text: string): CsvParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
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

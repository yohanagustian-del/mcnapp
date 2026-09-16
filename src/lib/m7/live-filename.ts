/**
 * M7 v2 Special Project — TikTok LIVE Center export filename parser (PRD addendum
 * §9, 16 Sep 2026). Username, session number, and date live ONLY in the filename —
 * the sheets themselves carry none of them. Real-world exports are inconsistent:
 * `product`/`Product`, `trend_stats`/`Trend_Stat`, `Sesi`/`sesi`. Pure function,
 * no I/O — returns null on anything unreadable so the caller can fall back to
 * manual entry (R37) instead of crashing (CLAUDE.md #7).
 *
 * Expected shape: `{username}_{product|trend_stats}_Sesi_{n}__{d}_{Bulan}_{yyyy}.xlsx`
 */
export interface ParsedLiveFilename {
  username: string;
  sessionNo: number;
  /** ISO yyyy-mm-dd. */
  date: string;
  kind: "product" | "trend_stats";
}

const MONTHS_ID: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

const FILENAME_RE =
  /^([a-z0-9._]+)_(product|trend[_ ]?stats?)_sesi_(\d+)__(\d{1,2})_([a-z]+)_(\d{4})\.xlsx$/i;

export function parseLiveFilename(filename: string): ParsedLiveFilename | null {
  const match = FILENAME_RE.exec(filename.trim());
  if (!match) return null;
  const [, username, kindRaw, sessionNoRaw, dayRaw, monthRaw, yearRaw] = match;

  const monthNum = MONTHS_ID[monthRaw.toLowerCase()];
  if (!monthNum) return null;

  const day = Number(dayRaw);
  if (day < 1 || day > 31) return null;
  const year = Number(yearRaw);

  return {
    username: username.toLowerCase(),
    sessionNo: Number(sessionNoRaw),
    date: `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    kind: kindRaw.toLowerCase().startsWith("product") ? "product" : "trend_stats",
  };
}

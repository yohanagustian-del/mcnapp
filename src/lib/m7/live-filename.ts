/**
 * M7 v2 Special Project — TikTok LIVE Center export filename parser (PRD addendum
 * §9, 16 Sep 2026). Username, session number, and date live ONLY in the filename —
 * the sheets themselves carry none of them. Real-world exports are inconsistent:
 * `Sesi`/`sesi`, `_` or ` ` as the separator, and anything at all between the
 * username and "sesi" (an Account Manager routinely renames these files before
 * upload, and whatever word was there — "product", "trend stats", "stats", or
 * nothing — is the first casualty). Pure function, no I/O — returns null on
 * anything unreadable so the caller can fall back to manual entry (R37) instead
 * of crashing (CLAUDE.md #7).
 *
 * Whether a file IS the Product sheet or the Trend Stats sheet used to be read
 * off this same filename word, but that broke the moment a real AM-renamed file
 * showed up (2026-09-17 QA) — see `detectLiveFileKind()` in live-parse.ts, which
 * decides that from the sheet's own columns instead (the one thing a rename
 * can't corrupt). This parser only extracts what genuinely lives ONLY in the
 * filename: username, session number, date.
 *
 * Two real filename shapes confirmed against actual TikTok LIVE Center exports
 * (2 creators, 16 Sep 2026 sample batch — see docs/data-samples/README.md):
 *   `haikalpratama136 Product sesi 1, 15 September 2026.xlsx`
 *   `haikalpratama136 Trend Stat Sesi 1, 15 September 2026.xlsx`
 *   `beayik_product Sesi 1, 15 September 2026.xlsx`
 *   `beayik_trend stats Sesi 1, 15 September 2026.xlsx`
 * — day/month/year is comma-separated, NOT the double-underscore the PRD assumed
 * before any real sample existed. That legacy `__d_Bulan_yyyy` shape is also still
 * accepted (harmless — some export tooling may still produce it), but a SINGLE
 * underscore before the day is deliberately rejected: with no comma and no double
 * underscore to disambiguate, "Sesi_1_5_..." could mean session 1 day 5 or session
 * 15 — never guess (CLAUDE.md #7).
 */
export interface ParsedLiveFilename {
  username: string;
  sessionNo: number;
  /** ISO yyyy-mm-dd. */
  date: string;
}

const MONTHS_ID: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

// Username is lazy ("+?") so it stops at the FIRST separator instead of
// swallowing through it — the username character class also allows "_", so a
// greedy match would happily eat "_product"/"_stats" as part of the username
// itself. Anything (".*?", lazy) is then allowed between that separator and
// "sesi" — an AM's rename can drop or reword the product/trend-stats hint
// entirely; it's no longer this parser's job to read it (see file header).
const FILENAME_RE =
  /^([a-z0-9._]+?)[ _]+.*?sesi[ _]*(\d+)(?:,\s*|__)(\d{1,2})[ _]+([a-z]+)[ _]+(\d{4})\.xlsx$/i;

export function parseLiveFilename(filename: string): ParsedLiveFilename | null {
  const match = FILENAME_RE.exec(filename.trim());
  if (!match) return null;
  const [, username, sessionNoRaw, dayRaw, monthRaw, yearRaw] = match;

  const monthNum = MONTHS_ID[monthRaw.toLowerCase()];
  if (!monthNum) return null;

  const day = Number(dayRaw);
  if (day < 1 || day > 31) return null;
  const year = Number(yearRaw);

  return {
    username: username.toLowerCase(),
    sessionNo: Number(sessionNoRaw),
    date: `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

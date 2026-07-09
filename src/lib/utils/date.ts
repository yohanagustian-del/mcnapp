const MONTHS: Record<string, number> = {
  january: 1, februari: 2, february: 2, march: 3, maret: 3, april: 4,
  may: 5, mei: 5, june: 6, juni: 6, july: 7, juli: 7, august: 8, agustus: 8,
  september: 9, october: 10, oktober: 10, november: 11, december: 12, desember: 12,
  januari: 1,
  // Abbreviations (ID/EN) — legacy sheets use "9 Sep 2024", "11-Dec-2026".
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8,
  sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Tolerant date parser for free-text legacy dates (CLAUDE.md #7):
 *  "19 February 2026", "1 June 2026", "2026-02-19", "19/02/2026" (day-first).
 * Returns ISO yyyy-mm-dd or null (empty/unparseable → flag review, never crash).
 */
export function parseFlexibleDate(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (s === "" || s === "-") return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const textual = s.match(/^(\d{1,2})[\s/-]+([a-zA-Z]+),?[\s/-]+(\d{4})$/);
  if (textual) {
    const m = MONTHS[textual[2].toLowerCase()];
    if (!m) return null;
    return toIso(Number(textual[3]), m, Number(textual[1]));
  }

  const textualUs = s.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (textualUs) {
    const m = MONTHS[textualUs[1].toLowerCase()];
    if (!m) return null;
    return toIso(Number(textualUs[3]), m, Number(textualUs[2]));
  }

  // Slash dates default day-first (ID); when the middle part can't be a month
  // ("04/21/2026" from US-formatted BD sheets) fall back to month-first.
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (b > 12 && a <= 12) return toIso(y, a, b); // mm/dd/yyyy
    return toIso(y, b, a); // dd/mm/yyyy
  }

  return null;
}

/**
 * Platform export "Date" column is a period range: "2026-06-03-2026-06-30".
 * A single date ("2026-06-03") is accepted as a one-day period.
 */
export function parsePeriodRange(
  raw: string | null | undefined
): { start: string; end: string } | null {
  if (!raw) return null;
  const s = raw.trim();
  const range = s.match(/^(\d{4}-\d{2}-\d{2})\s*[-–~]\s*(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    const start = parseFlexibleDate(range[1]);
    const end = parseFlexibleDate(range[2]);
    return start && end ? { start, end } : null;
  }
  const single = parseFlexibleDate(s);
  return single ? { start: single, end: single } : null;
}

/**
 * Number of days in a given month (1-12) of a given year (accounts for leap
 * years). Exported for the ingest calendar UI (need to know whether W5
 * exists for a given month — Feb non-kabisat ends at day 28 == no W5).
 */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of next month == last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Upload week-of-month scheme (final, CLAUDE.md / BUILD_PLAN decision — W1-W5):
 *   W1 = 1-7, W2 = 8-14, W3 = 15-21, W4 = 22-28, W5 = 29-end of month.
 * Derives the window index purely from the day-of-month; caller supplies a
 * `Date` already anchored to the correct calendar day (see validateW1W5Period
 * for the string-based counterpart used on upload period boundaries).
 */
export function weekOfMonth(date: Date): 1 | 2 | 3 | 4 | 5 {
  const day = date.getUTCDate();
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  if (day <= 28) return 4;
  return 5;
}

/**
 * Validates that an upload period [start, end] (YYYY-MM-DD, inclusive) matches
 * exactly one of the locked W1-W5 windows for a single month (CLAUDE.md upload
 * week-scheme decision). No cross-month periods; W5 only exists for the day
 * range 29-end_of_month (Feb non-kabisat has no W5 since it ends at 28 == W4).
 *
 * Parsed via plain string slicing (no `Date` object) to stay consistent with
 * the rest of this file's ISO-string convention and avoid local/UTC offset
 * bugs — every other date here is a YYYY-MM-DD string, not a Date instance.
 */
export function validateW1W5Period(
  start: string,
  end: string
): { valid: boolean; reason?: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/;
  const s = start.match(m);
  const e = end.match(m);
  const schemeHint =
    "Skema yang benar: W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir bulan (bulan Februari non-kabisat tidak punya W5).";

  if (!s || !e) {
    return {
      valid: false,
      reason: `Format tanggal periode tidak valid (start="${start}", end="${end}"). Gunakan format YYYY-MM-DD. ${schemeHint}`,
    };
  }

  const [, sy, smo, sd] = s;
  const [, ey, emo, ed] = e;
  const startYear = Number(sy);
  const startMonth = Number(smo);
  const startDay = Number(sd);
  const endYear = Number(ey);
  const endMonth = Number(emo);
  const endDay = Number(ed);

  if (startYear !== endYear || startMonth !== endMonth) {
    return {
      valid: false,
      reason: `Periode upload (${start} s/d ${end}) tidak boleh menyebrang bulan. ${schemeHint}`,
    };
  }

  const lastDay = daysInMonth(startYear, startMonth);
  const allWindows: Array<{ week: 1 | 2 | 3 | 4 | 5; start: number; end: number }> = [
    { week: 1, start: 1, end: 7 },
    { week: 2, start: 8, end: 14 },
    { week: 3, start: 15, end: 21 },
    { week: 4, start: 22, end: 28 },
    { week: 5, start: 29, end: lastDay },
  ];
  const windows = allWindows.filter((w) => w.start <= lastDay);

  const match = windows.find((w) => w.start === startDay && w.end === endDay);
  if (!match) {
    const windowList = windows.map((w) => `W${w.week}=${w.start}-${w.end}`).join(", ");
    return {
      valid: false,
      reason: `Periode upload (${start} s/d ${end}) tidak sesuai window W1-W5 manapun untuk bulan ${startMonth}/${startYear}. Window yang valid bulan ini: ${windowList}.`,
    };
  }

  return { valid: true };
}

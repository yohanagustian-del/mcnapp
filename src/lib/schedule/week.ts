// Week math for the live-schedule calendar. All plain date arithmetic on YYYY-MM-DD
// strings — WIB semantics with NO timezone conversion (the app treats schedule_date as
// a wall-clock date). Never construct `new Date(iso)` for math (that parses as UTC);
// we split the string and use Date.UTC purely as an integer calendar, then re-format.

const DAY_MS = 86_400_000;

/** Parse a YYYY-MM-DD string into a UTC-epoch calendar day (no local-TZ drift). */
function parseIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Format a UTC-epoch day back to YYYY-MM-DD. */
function toIso(epoch: number): string {
  const dt = new Date(epoch);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Monday of the week containing `date`, as YYYY-MM-DD. Uses the date's local Y/M/D
 * (wall clock) so callers can pass `new Date()` in WIB without conversion surprises.
 */
export function getWeekStart(date: Date): string {
  const epoch = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  // getUTCDay: 0=Sun..6=Sat. Monday-based offset: Sun→6, Mon→0, Tue→1, ...
  const dow = new Date(epoch).getUTCDay();
  const backToMonday = (dow + 6) % 7;
  return toIso(epoch - backToMonday * DAY_MS);
}

/** The 7 ISO dates (Mon..Sun) of the week starting at `weekStart`. */
export function getWeekDays(weekStart: string): string[] {
  const start = parseIso(weekStart);
  return Array.from({ length: 7 }, (_, i) => toIso(start + i * DAY_MS));
}

const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** Indonesian short label, e.g. "Sen 11 Mei". */
export function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_LABELS[dow]} ${d} ${MONTH_LABELS[m - 1]}`;
}

/** Monday of the previous week. */
export function prevWeek(weekStart: string): string {
  return toIso(parseIso(weekStart) - 7 * DAY_MS);
}

/** Monday of the next week. */
export function nextWeek(weekStart: string): string {
  return toIso(parseIso(weekStart) + 7 * DAY_MS);
}

/**
 * Pemilih periode bersama summary BizDev, TAP Matchmaking, dan Report Brand v2
 * (REVISI_BIZDEV Q2: default bulan berjalan + bisa pilih bulan lain / minggu W1–W5).
 * SATU util — jangan bikin parser periode kedua.
 *
 * Nilai URL `?period=`:
 *   "2026-10"     → bulan Oktober 2026 (dibaca dari view bulanan, period_month)
 *   "2026-10-W2"  → minggu W2 Oktober (period_start = 2026-10-08, view mingguan)
 * Skema W1–W5 sama dengan ingest: W1=1–7, W2=8–14, W3=15–21, W4=22–28, W5=29–akhir.
 */

export type PeriodSelection =
  | { kind: "month"; value: string; month: string; monthStart: string; label: string }
  | { kind: "week"; value: string; month: string; week: number; periodStart: string; label: string };

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Minggu W1–W5 yang ada di bulan itu (Februari non-kabisat tidak punya W5). */
export function weeksInMonth(month: string): number[] {
  const [y, m] = month.split("-").map(Number);
  return daysInMonth(y, m) >= 29 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_ID[m - 1]} ${y}`;
}

/** Tanggal (YYYY-MM-DD) → nilai bulan berjalan "YYYY-MM". */
export function currentMonthValue(todayIso: string): string {
  return todayIso.slice(0, 7);
}

/**
 * `?period=` → seleksi tervalidasi. Nilai kosong/rusak → bulan berjalan (default Q2),
 * bukan error: URL yang diketik tangan tidak boleh mematahkan halaman.
 */
export function parsePeriodParam(raw: string | null | undefined, todayIso: string): PeriodSelection {
  const fallbackMonth = currentMonthValue(todayIso);
  const v = (raw ?? "").trim();
  const week = v.match(/^(\d{4})-(\d{2})-W([1-5])$/i);
  if (week) {
    const month = `${week[1]}-${week[2]}`;
    const w = Number(week[3]);
    const mm = Number(week[2]);
    if (mm >= 1 && mm <= 12 && weeksInMonth(month).includes(w)) {
      const startDay = 1 + (w - 1) * 7;
      return {
        kind: "week",
        value: `${month}-W${w}`,
        month,
        week: w,
        periodStart: `${month}-${pad2(startDay)}`,
        label: `W${w} ${monthLabel(month)}`,
      };
    }
  }
  const monthMatch = v.match(/^(\d{4})-(\d{2})$/);
  const month =
    monthMatch && Number(monthMatch[2]) >= 1 && Number(monthMatch[2]) <= 12 ? v : fallbackMonth;
  return { kind: "month", value: month, month, monthStart: `${month}-01`, label: monthLabel(month) };
}

/** Opsi dropdown: N bulan terakhir (terbaru dulu), tiap bulan diikuti minggu-minggunya. */
export function periodOptions(todayIso: string, months = 6): { value: string; label: string }[] {
  const [y, m] = currentMonthValue(todayIso).split("-").map(Number);
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const month = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    out.push({ value: month, label: `${monthLabel(month)} (sebulan)` });
    for (const w of weeksInMonth(month)) out.push({ value: `${month}-W${w}`, label: `  W${w} ${monthLabel(month)}` });
  }
  return out;
}

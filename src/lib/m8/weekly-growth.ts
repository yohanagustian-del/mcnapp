/**
 * M8 Weekly Growth (W1-W5) — pure rule-based helper, 0 token AI.
 *
 * Turns creator_period_summary rows into a per-creator monthly view: GMV per
 * week bucket (W1..W5), month total, and week-over-week deltas. Never touches
 * Supabase — callers (CM Workspace, Creator Detail page) fetch rows and pass
 * them in, so this stays unit-testable without a DB.
 *
 * Week scheme (final, CLAUDE.md-adjacent decision): W1=1-7, W2=8-14, W3=15-21,
 * W4=22-28, W5=29-akhir bulan. period_start is always the window's start date;
 * the day-of-month of period_start alone determines the week index.
 */

export interface WeeklyGrowthInputRow {
  creatorId: string;
  periodStart: string; // "YYYY-MM-DD"
  periodEnd: string; // "YYYY-MM-DD"
  affiliateGmv: number;
  createdAt: string; // ISO timestamp — used to break ties on duplicate (creator, periodStart)
}

export interface MonthlyGrowth {
  /** GMV per week W1..W5 (index 0 = W1). null = no upload for that week. */
  weeks: (number | null)[];
  /** Sum of all filled weeks in the month. */
  monthTotal: number;
  /** % change vs the previous FILLED week (index-aligned with `weeks`). First filled week is null. */
  deltas: (number | null)[];
  /** % change: last filled week vs first filled week. null if fewer than 2 filled weeks. */
  monthGrowthPct: number | null;
}

/**
 * Generic multi-metric row for `groupWeeksByMonth` — same shape contract as
 * WeeklyGrowthInputRow (periodStart/createdAt drive the same dedupe + canonical
 * week-start preference), but carries an arbitrary metric-name -> value map so
 * one grouping pass can serve callers that need more than affiliate_gmv alone
 * (e.g. gmv_total/affiliate_live_gmv/affiliate_video_gmv together for a
 * creator's monthly average — see buildMonthlyAverages below).
 */
export interface MultiMetricInputRow {
  creatorId: string;
  periodStart: string; // "YYYY-MM-DD"
  createdAt: string;
  metrics: Record<string, number>;
}

const WEEK_COUNT = 5;
/** Canonical first day-of-month for each week bucket (W1..W5) — see weekIndexOf. */
const WEEK_START_DAYS = [1, 8, 15, 22, 29];

/**
 * Maps a period_start date to its week index (1..5) within its month, per the
 * final W1-W5 scheme: W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir bulan.
 */
export function weekIndexOf(periodStart: string): number {
  const day = Number(periodStart.slice(8, 10));
  if (!Number.isFinite(day) || day < 1) {
    throw new Error(`period_start tidak valid: ${periodStart}`);
  }
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  if (day <= 28) return 4;
  return 5;
}

/** True when period_start lands exactly on the week bucket's canonical start day (1/8/15/22/29). */
function isCanonicalWeekStart(periodStart: string): boolean {
  const day = Number(periodStart.slice(8, 10));
  return WEEK_START_DAYS.includes(day);
}

/** Extracts "YYYY-MM" from a "YYYY-MM-DD" period_start. */
function monthOf(periodStart: string): string {
  return periodStart.slice(0, 7);
}

/**
 * Distinct months present in `rows`, sorted descending (newest first).
 */
export function availableMonths(rows: WeeklyGrowthInputRow[]): string[] {
  const months = new Set<string>();
  for (const r of rows) months.add(monthOf(r.periodStart));
  return [...months].sort((a, b) => b.localeCompare(a));
}

/**
 * Core grouping pass shared by buildMonthlyGrowth (single metric) and
 * buildMonthlyAverages (multi-metric): dedupes duplicate (creatorId,
 * periodStart) rows — latest createdAt wins — then buckets the survivors into
 * week index 0..4 per creator, preferring whichever row sits exactly on the
 * bucket's canonical start day (1/8/15/22/29, the real weekly-ingest cadence)
 * when two different period_start values collide on the same week index (e.g.
 * a stray non-ingest upload_batch), falling back to latest createdAt.
 *
 * Returns, per creator, an array of WEEK_COUNT slots each holding the winning
 * row's `metrics` map (or null when no row fills that week) — callers project
 * out whichever metric(s) they need. One grouping implementation for both
 * consumers (CLAUDE.md #4: don't duplicate the month/week grouping logic).
 */
function groupWeeksByMonth(
  rows: MultiMetricInputRow[],
  month: string
): Map<string, (Record<string, number> | null)[]> {
  // Dedupe: latest createdAt wins per (creatorId, periodStart).
  const latestByKey = new Map<string, MultiMetricInputRow>();
  for (const row of rows) {
    if (monthOf(row.periodStart) !== month) continue;
    const key = `${row.creatorId}|${row.periodStart}`;
    const existing = latestByKey.get(key);
    if (!existing || row.createdAt > existing.createdAt) {
      latestByKey.set(key, row);
    }
  }

  const byCreatorRow = new Map<string, MultiMetricInputRow[]>();
  for (const row of latestByKey.values()) {
    const idx = weekIndexOf(row.periodStart) - 1;
    const key = `${row.creatorId}|${idx}`;
    const list = byCreatorRow.get(key) ?? [];
    list.push(row);
    byCreatorRow.set(key, list);
  }
  const byCreator = new Map<string, (Record<string, number> | null)[]>();
  for (const [key, candidates] of byCreatorRow) {
    const [creatorId, idxStr] = key.split("|");
    const idx = Number(idxStr);
    const winner = candidates.reduce((best, candidate) => {
      const bestCanonical = isCanonicalWeekStart(best.periodStart);
      const candidateCanonical = isCanonicalWeekStart(candidate.periodStart);
      if (candidateCanonical && !bestCanonical) return candidate;
      if (bestCanonical && !candidateCanonical) return best;
      return candidate.createdAt > best.createdAt ? candidate : best;
    });
    const weeks = byCreator.get(creatorId) ?? new Array(WEEK_COUNT).fill(null);
    weeks[idx] = winner.metrics;
    byCreator.set(creatorId, weeks);
  }
  return byCreator;
}

/**
 * Turns a W1..W5 GMV series into total + deltas. Extracted so per-creator rows,
 * the per-CM rollup, and any TOTAL footer all derive growth the SAME way
 * (CLAUDE.md #4: one implementation, tidak dihitung ulang beda-beda).
 *
 * `deltas[i]` = perubahan vs minggu TERISI sebelumnya (minggu kosong dilewati,
 * bukan dianggap nol), jadi minggu tanpa upload tidak memalsukan penurunan 100%.
 */
export function summarizeWeeks(weeks: (number | null)[]): MonthlyGrowth {
  let monthTotal = 0;
  const deltas: (number | null)[] = new Array(WEEK_COUNT).fill(null);
  let lastFilledIdx: number | null = null;
  let firstFilledIdx: number | null = null;

  for (let i = 0; i < WEEK_COUNT; i++) {
    const v = weeks[i];
    if (v === null || v === undefined) continue;
    monthTotal += v;
    if (firstFilledIdx === null) firstFilledIdx = i;
    if (lastFilledIdx !== null) {
      const prev = weeks[lastFilledIdx] as number;
      deltas[i] = prev !== 0 ? (v - prev) / prev : null;
    }
    lastFilledIdx = i;
  }

  let monthGrowthPct: number | null = null;
  if (firstFilledIdx !== null && lastFilledIdx !== null && firstFilledIdx !== lastFilledIdx) {
    const first = weeks[firstFilledIdx] as number;
    const last = weeks[lastFilledIdx] as number;
    monthGrowthPct = first !== 0 ? (last - first) / first : null;
  }

  return { weeks, monthTotal, deltas, monthGrowthPct };
}

/**
 * Menjumlahkan beberapa deret mingguan jadi satu. Minggu tetap `null` kalau TIDAK
 * ADA satu pun anggota yang punya data di minggu itu — membedakan "belum ada
 * upload" dari "ada upload, GMV-nya Rp0".
 */
export function sumWeeks(series: (number | null)[][]): (number | null)[] {
  const totals: (number | null)[] = new Array(WEEK_COUNT).fill(null);
  for (const weeks of series) {
    for (let i = 0; i < WEEK_COUNT; i++) {
      const v = weeks[i];
      if (v === null || v === undefined) continue;
      totals[i] = (totals[i] ?? 0) + v;
    }
  }
  return totals;
}

/** Satu grup hasil `aggregateWeeklyByGroup` — mis. satu CM beserta kreatornya. */
export interface GroupedWeeklyGrowth extends MonthlyGrowth {
  /** Kunci grup apa adanya (mis. owner_cpm_id, atau "" untuk tanpa CM). */
  key: string;
  /** Berapa anggota (kreator) yang menyumbang ke grup ini. */
  members: number;
}

/**
 * Rollup deret mingguan per grup — dipakai tabel "Growth Mingguan per CM":
 * jumlahkan W1..W5 seluruh kreator milik satu CM, lalu hitung delta dari hasil
 * penjumlahan itu (bukan rata-rata delta per kreator, yang akan memberi bobot
 * sama pada kreator besar dan kecil).
 */
export function aggregateWeeklyByGroup<T>(
  rows: T[],
  keyOf: (row: T) => string,
  weeksOf: (row: T) => (number | null)[]
): GroupedWeeklyGrowth[] {
  const byKey = new Map<string, (number | null)[][]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = byKey.get(key) ?? [];
    list.push(weeksOf(row));
    byKey.set(key, list);
  }
  return [...byKey].map(([key, series]) => ({
    key,
    members: series.length,
    ...summarizeWeeks(sumWeeks(series)),
  }));
}

/**
 * Builds per-creator W1-W5 GMV, month total, and growth deltas for the given
 * month ("YYYY-MM"). Rows outside the month are ignored. Duplicate
 * (creatorId, periodStart) — e.g. leftover from an old re-upload batch — keep
 * the row with the latest createdAt.
 */
export function buildMonthlyGrowth(
  rows: WeeklyGrowthInputRow[],
  month: string
): Map<string, MonthlyGrowth> {
  const genericRows: MultiMetricInputRow[] = rows.map((r) => ({
    creatorId: r.creatorId,
    periodStart: r.periodStart,
    createdAt: r.createdAt,
    metrics: { gmv: r.affiliateGmv },
  }));
  const byCreatorMetrics = groupWeeksByMonth(genericRows, month);
  const byCreator = new Map<string, (number | null)[]>();
  for (const [creatorId, weekMetrics] of byCreatorMetrics) {
    byCreator.set(creatorId, weekMetrics.map((m) => (m ? m.gmv : null)));
  }

  const result = new Map<string, MonthlyGrowth>();
  for (const [creatorId, weeks] of byCreator) {
    result.set(creatorId, summarizeWeeks(weeks));
  }

  return result;
}

/** Per-creator monthly averages across every month that had at least one filled week. */
export interface AvgMonthlyGmv {
  /** Average of each month's TOTAL gmv (sum of that month's filled weeks), across all months with data. */
  gmv: number;
  /** Same averaging, but for affiliate_live_gmv. */
  gmvLive: number;
  /** Same averaging, but for affiliate_video_gmv. */
  gmvVideo: number;
  /** How many distinct months contributed to the average (denominator). */
  monthsCounted: number;
}

export interface AvgMonthlyGmvInputRow {
  creatorId: string;
  periodStart: string; // "YYYY-MM-DD"
  createdAt: string;
  gmvTotal: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
}

/**
 * Task A.1: monthly GMV average for the /creators master list — groups rows by
 * calendar month (canonical week-start 1/8/15/22/29 always falls in-month, per
 * weekIndexOf), sums each month's filled weeks, then averages ACROSS ALL MONTHS
 * THAT HAVE DATA (months with zero rows are skipped, not counted as zero).
 * Reuses groupWeeksByMonth's dedupe + canonical-week-start-wins collision rule
 * (same contract as buildMonthlyGrowth — CLAUDE.md #4: one grouping
 * implementation, not a second copy) — run once per month present in `rows`.
 *
 * gmv/gmvLive/gmvVideo are averaged independently (a month can have live data
 * without video data in the same row, since they come from the same
 * creator_period_summary row per week — but this keeps the three metrics
 * computed the same way for symmetry and future-proofing).
 */
export function buildMonthlyAverages(rows: AvgMonthlyGmvInputRow[]): AvgMonthlyGmv {
  const genericRows: MultiMetricInputRow[] = rows.map((r) => ({
    creatorId: r.creatorId,
    periodStart: r.periodStart,
    createdAt: r.createdAt,
    metrics: { gmv: r.gmvTotal, gmvLive: r.affiliateLiveGmv, gmvVideo: r.affiliateVideoGmv },
  }));

  const months = new Set<string>();
  for (const r of rows) months.add(monthOf(r.periodStart));

  let gmvSum = 0;
  let gmvLiveSum = 0;
  let gmvVideoSum = 0;
  let monthsCounted = 0;

  for (const month of months) {
    // Single creatorId assumed (caller scopes rows to one creator — see
    // autoFillCreators / backfill script) but the grouping helper is
    // creator-agnostic, so just take whichever creator key comes out.
    const byCreatorMetrics = groupWeeksByMonth(genericRows, month);
    let monthHasData = false;
    let monthGmv = 0;
    let monthGmvLive = 0;
    let monthGmvVideo = 0;
    for (const weekMetrics of byCreatorMetrics.values()) {
      for (const m of weekMetrics) {
        if (!m) continue;
        monthHasData = true;
        monthGmv += m.gmv;
        monthGmvLive += m.gmvLive;
        monthGmvVideo += m.gmvVideo;
      }
    }
    if (!monthHasData) continue;
    monthsCounted++;
    gmvSum += monthGmv;
    gmvLiveSum += monthGmvLive;
    gmvVideoSum += monthGmvVideo;
  }

  if (monthsCounted === 0) {
    return { gmv: 0, gmvLive: 0, gmvVideo: 0, monthsCounted: 0 };
  }
  return {
    gmv: gmvSum / monthsCounted,
    gmvLive: gmvLiveSum / monthsCounted,
    gmvVideo: gmvVideoSum / monthsCounted,
    monthsCounted,
  };
}

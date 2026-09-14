/**
 * Agregasi adopsi sistem (QA feedback /okr): jam pemakaian tools per user per
 * minggu dari tool_usage_logs (page-view). Deterministik, 0 token AI.
 *
 * Sessionization: page-view berurutan dengan gap ≤ SESSION_GAP_MIN dianggap satu
 * sesi; durasi sesi = last−first, minimal MIN_SESSION_MIN (sesi 1 view tetap
 * dihitung aktivitas singkat).
 *
 * Akumulasi per minggu (Senin−Minggu, UTC): sebuah sesi masuk ke minggu tempat
 * sesi itu DIMULAI (waktu view pertamanya).
 */
export const SESSION_GAP_MIN = 30;
export const MIN_SESSION_MIN = 5;

export interface UsageLog {
  member_id: string;
  occurred_at: string; // ISO timestamp
}

export interface WeeklyUsage {
  memberId: string;
  /** Senin minggu itu, YYYY-MM-DD (UTC). */
  weekStart: string;
  /** Minggu ke bulan mana difilter — bulan dari weekStart, YYYY-MM. */
  month: string;
  hours: number;
  sessions: number;
  pageViews: number;
}

/** Senin (00:00 UTC) dari minggu yang memuat waktu `ms`. */
function mondayOf(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Minggu..6=Sabtu
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function aggregateUsageByWeek(
  logs: UsageLog[],
  gapMinutes: number = SESSION_GAP_MIN,
  minSessionMinutes: number = MIN_SESSION_MIN
): WeeklyUsage[] {
  const byMember = new Map<string, number[]>();
  for (const l of logs) {
    const t = new Date(l.occurred_at).getTime();
    if (!Number.isFinite(t)) continue;
    const arr = byMember.get(l.member_id) ?? [];
    arr.push(t);
    byMember.set(l.member_id, arr);
  }

  const out = new Map<string, WeeklyUsage>(); // key `${memberId}|${weekStart}`
  const gapMs = gapMinutes * 60_000;
  const minMs = minSessionMinutes * 60_000;

  for (const [memberId, times] of byMember) {
    times.sort((a, b) => a - b);
    let start = times[0];
    let prev = times[0];
    let views = 1;

    const flush = (endTime: number, viewCount: number) => {
      const dur = Math.max(endTime - start, minMs);
      const weekStart = isoDate(mondayOf(start));
      const key = `${memberId}|${weekStart}`;
      const cur = out.get(key) ?? {
        memberId,
        weekStart,
        month: weekStart.slice(0, 7),
        hours: 0,
        sessions: 0,
        pageViews: 0,
      };
      cur.hours += dur / 3_600_000;
      cur.sessions += 1;
      cur.pageViews += viewCount;
      out.set(key, cur);
    };

    for (let i = 1; i < times.length; i++) {
      if (times[i] - prev > gapMs) {
        flush(prev, views);
        start = times[i];
        views = 0;
      }
      prev = times[i];
      views++;
    }
    flush(prev, views);
  }

  return [...out.values()]
    .map((u) => ({ ...u, hours: Math.round(u.hours * 10) / 10 }))
    .sort((a, b) => (a.weekStart === b.weekStart ? b.hours - a.hours : b.weekStart.localeCompare(a.weekStart)));
}

/** Label tampil "8–14 Sep 2026" dari Senin (weekStart, YYYY-MM-DD). */
export function formatWeekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const startLabel = start.toLocaleDateString("id-ID", { day: "numeric", timeZone: "UTC" });
  const endLabel = end.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${startLabel}–${endLabel}`;
}

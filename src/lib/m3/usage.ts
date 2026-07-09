/**
 * Agregasi adopsi sistem (QA feedback /okr): jam pemakaian tools per user per
 * bulan dari tool_usage_logs (page-view). Deterministik, 0 LLM.
 *
 * Sessionization: page-view berurutan dengan gap ≤ SESSION_GAP_MIN dianggap satu
 * sesi; durasi sesi = last−first, minimal MIN_SESSION_MIN (sesi 1 view tetap
 * dihitung aktivitas singkat).
 */
export const SESSION_GAP_MIN = 30;
export const MIN_SESSION_MIN = 5;

export interface UsageLog {
  member_id: string;
  occurred_at: string; // ISO timestamp
}

export interface MonthlyUsage {
  memberId: string;
  month: string; // YYYY-MM
  hours: number;
  sessions: number;
  pageViews: number;
}

export function aggregateUsageHours(
  logs: UsageLog[],
  gapMinutes: number = SESSION_GAP_MIN,
  minSessionMinutes: number = MIN_SESSION_MIN
): MonthlyUsage[] {
  const byMember = new Map<string, number[]>();
  for (const l of logs) {
    const t = new Date(l.occurred_at).getTime();
    if (!Number.isFinite(t)) continue;
    const arr = byMember.get(l.member_id) ?? [];
    arr.push(t);
    byMember.set(l.member_id, arr);
  }

  const out = new Map<string, MonthlyUsage>(); // key `${memberId}|${month}`
  const gapMs = gapMinutes * 60_000;
  const minMs = minSessionMinutes * 60_000;

  for (const [memberId, times] of byMember) {
    times.sort((a, b) => a - b);
    let start = times[0];
    let prev = times[0];
    let views = 1;

    const flush = (endTime: number, viewCount: number) => {
      const dur = Math.max(endTime - start, minMs);
      const d = new Date(start);
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const key = `${memberId}|${month}`;
      const cur = out.get(key) ?? { memberId, month, hours: 0, sessions: 0, pageViews: 0 };
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
    .sort((a, b) => (a.month === b.month ? b.hours - a.hours : b.month.localeCompare(a.month)));
}

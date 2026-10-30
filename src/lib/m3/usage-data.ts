import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeWeeklyUsage, MIN_SESSION_MIN, SESSION_GAP_MIN, type WeeklyUsage } from "./usage";

/**
 * Data tabel "Adopsi Sistem" (/okr). Agregasi dilakukan di database (migrasi 0099:
 * usage_hours_by_week + latest_audit_activity, masing-masing SATU nilai jsonb) —
 * JANGAN kembali menarik baris mentah tool_usage_logs/audit_logs lalu mengagregasi
 * di JS: PostgREST memotong tiap response di max_rows (1000), di luar kendali
 * .limit(), sehingga minggu lama/Last Activity hilang diam-diam (OD 2026-10-26).
 */
export interface UsageAdoptionData {
  weekly: WeeklyUsage[];
  lastAccessByMember: Map<string, string>;
  lastActivityByMember: Map<string, { at: string; action: string }>;
}

interface WeekRow {
  member_id: string;
  week_start: string;
  seconds: number;
  sessions: number;
  page_views: number;
  last_access: string;
}

interface AuditRow {
  actor_id: string;
  action: string;
  created_at: string;
}

export async function loadUsageAdoption(supabase: SupabaseClient, sinceIso: string): Promise<UsageAdoptionData> {
  const [usage, audit] = await Promise.all([
    supabase.rpc("usage_hours_by_week", {
      p_from: sinceIso,
      p_gap_minutes: SESSION_GAP_MIN,
      p_min_session_minutes: MIN_SESSION_MIN,
    }),
    supabase.rpc("latest_audit_activity", { p_from: sinceIso }),
  ]);
  if (usage.error) throw new Error(`usage_hours_by_week: ${usage.error.message}`);
  if (audit.error) throw new Error(`latest_audit_activity: ${audit.error.message}`);

  const weekRows = (usage.data ?? []) as WeekRow[];
  const lastAccessByMember = new Map<string, string>();
  for (const r of weekRows) lastAccessByMember.set(r.member_id, r.last_access);

  const lastActivityByMember = new Map<string, { at: string; action: string }>();
  for (const a of (audit.data ?? []) as AuditRow[]) {
    lastActivityByMember.set(a.actor_id, { at: a.created_at, action: a.action });
  }

  const weekly = finalizeWeeklyUsage(
    weekRows.map((r) => ({
      memberId: r.member_id,
      weekStart: r.week_start,
      month: r.week_start.slice(0, 7),
      hours: Number(r.seconds) / 3600,
      sessions: Number(r.sessions),
      pageViews: Number(r.page_views),
    }))
  );
  return { weekly, lastAccessByMember, lastActivityByMember };
}

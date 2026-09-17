/**
 * M7 v2 Special Project — report peserta `data_json` builder (PRD §6.8, K5).
 * Rank and cohort averages are read from `project_creator_report_v`, computed
 * IN SQL (window functions) — this file only shapes what the view/queries
 * already computed into the JSON contract; it never re-aggregates raw rows
 * (CLAUDE.md #4: one source of truth) and never calls an LLM.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLiveNotes } from "./live-notes";

/**
 * Live-session detail (PRD addendum §9/§10.4) — the part of the report that
 * describes HOW the live ran, not just what it totalled: the 30-minute timeline,
 * the tayang → beli funnel, and the efficiency/interaction figures.
 *
 * Split of sources follows §9 exactly, no second implementation of either:
 *  - `project_live_sessions` = the Product-file totals (commerce truth) plus the
 *    session's own meta (brand, jam, durasi) and the Trend totals already stored
 *    at upload (views, viewers_peak, impressions_live).
 *  - `project_live_intervals` = the timeline AND the interaction counts, which
 *    exist per interval only (the session-level columns for likes/comments/
 *    shares/new_followers are not written by the ingest).
 * Ratios (ctr/ctor/gpm) are derived here, once, from those stored counts.
 */
export interface ProjectReportLive {
  sessions: number;
  brands: string[];
  first_date: string | null;
  last_date: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_min: number;
  /** Live-session scope (the funnel below is a live funnel, not a project-wide one). */
  gmv: number;
  orders: number;
  items: number;
  customers: number;
  views: number;
  viewers_peak: number;
  /** null when no session carries it — uploads before this was parsed (§9). */
  impressions_live: number | null;
  product_impressions: number;
  product_clicks: number;
  add_to_cart: number;
  likes: number;
  comments: number;
  shares: number;
  new_followers: number;
  ctr: number | null;
  ctor: number | null;
  gpm: number | null;
  /** Trend Stats' own GMV total vs the Product file's — shown as a data note (§10.2 V6). */
  gmv_trend: number | null;
  gmv_trend_diff: number | null;
  timeline: { label: string; gmv: number; viewers: number | null }[];
  /**
   * Catatan performa deterministik (live-notes.ts) — bukan narasi LLM, jadi
   * selalu ada walau ANTHROPIC_API_KEY tidak di-set dan boleh tampil di draft.
   */
  notes: string[];
}

export interface ProjectReportData {
  period: {
    type: "project";
    start: string;
    end: string;
    project_id: number;
    project_name: string;
    project_type: string;
  };
  creator: { id: string; name: string; level: number | null; niche: string | null };
  target: { personal_gmv: number; project_gmv: number };
  metrics: {
    gmv: number; live_gmv: number; video_gmv: number; orders: number; items: number;
    aov: number; live_share: number; active_days: number;
  };
  achievement: { personal_pct: number; share_of_project: number; rank: number; of: number };
  cohort_avg: { gmv: number; live_share: number; active_days: number };
  daily: { date: string; gmv: number }[];
  top_products: { name: string; gmv: number; items: number }[];
  /** Absent on reports generated before live detail existed — renderers must tolerate it. */
  live?: ProjectReportLive;
}

/**
 * Builds one participant's project report data. Throws when the project or
 * the participant isn't found — the caller (generate action) is expected to
 * have already validated both exist before calling this.
 */
export async function buildProjectReportData(
  supabase: SupabaseClient,
  projectId: number,
  creatorId: string
): Promise<ProjectReportData> {
  const [{ data: project }, { data: creator }, { data: participant }, { data: reportRow }, { data: dailyRows }, { data: productRows }] =
    await Promise.all([
      supabase.from("special_projects").select("id, name, type, start_date, end_date, target_gmv").eq("id", projectId).single(),
      supabase.from("creators").select("id, name, level, niche").eq("id", creatorId).single(),
      supabase.from("project_participants").select("target_gmv").eq("project_id", projectId).eq("creator_id", creatorId).single(),
      supabase
        .from("project_creator_report_v")
        .select("gmv, live_gmv, video_gmv, orders, items, active_days, live_share, rank, of, project_total_gmv, cohort_avg_gmv, cohort_avg_live_share, cohort_avg_active_days")
        .eq("project_id", projectId).eq("creator_id", creatorId).maybeSingle(),
      supabase
        .from("project_creator_metrics")
        .select("date, gmv_actual")
        .eq("project_id", projectId).eq("creator_id", creatorId).order("date"),
      supabase
        .from("project_creator_products")
        .select("product_name, gmv, items")
        .eq("project_id", projectId).eq("creator_id", creatorId)
        .order("gmv", { ascending: false }).limit(3),
    ]);

  if (!project) throw new Error("Project tidak ditemukan");
  if (!creator) throw new Error("Kreator tidak ditemukan");
  if (!participant) throw new Error("Kreator ini bukan peserta project");

  const live = await buildLiveDetail(supabase, projectId, creatorId);

  // R29: peserta gmv=0 (belum pernah punya baris di project_creator_metrics,
  // sehingga TIDAK muncul di project_creator_report_v) tetap dapat report —
  // isi nol daripada gagal.
  const r = reportRow ?? {
    gmv: 0, live_gmv: 0, video_gmv: 0, orders: 0, items: 0, active_days: 0, live_share: 0,
    rank: null, of: null, project_total_gmv: 0, cohort_avg_gmv: 0, cohort_avg_live_share: 0, cohort_avg_active_days: 0,
  };

  const gmv = Number(r.gmv ?? 0);
  const orders = Number(r.orders ?? 0);
  const personalTarget = Number(participant.target_gmv ?? 0);
  const projectTotalGmv = Number(r.project_total_gmv ?? 0);

  return {
    period: {
      type: "project", start: project.start_date, end: project.end_date,
      project_id: project.id, project_name: project.name, project_type: project.type,
    },
    creator: { id: creator.id, name: creator.name, level: creator.level, niche: creator.niche },
    target: { personal_gmv: personalTarget, project_gmv: Number(project.target_gmv ?? 0) },
    metrics: {
      gmv, live_gmv: Number(r.live_gmv ?? 0), video_gmv: Number(r.video_gmv ?? 0),
      orders, items: Number(r.items ?? 0), aov: orders > 0 ? gmv / orders : 0,
      live_share: Number(r.live_share ?? 0), active_days: Number(r.active_days ?? 0),
    },
    achievement: {
      personal_pct: personalTarget > 0 ? gmv / personalTarget : 0,
      share_of_project: projectTotalGmv > 0 ? gmv / projectTotalGmv : 0,
      // No row in the view = only this creator has zero activity in a project with
      // no other participants yet either; rank/of degrade to 1/1 rather than null.
      rank: r.rank ?? 1,
      of: r.of ?? 1,
    },
    cohort_avg: {
      gmv: Number(r.cohort_avg_gmv ?? 0),
      live_share: Number(r.cohort_avg_live_share ?? 0),
      active_days: Number(r.cohort_avg_active_days ?? 0),
    },
    daily: (dailyRows ?? []).map((d) => ({ date: d.date, gmv: Number(d.gmv_actual ?? 0) })),
    top_products: (productRows ?? []).map((p) => ({
      name: p.product_name ?? "—", gmv: Number(p.gmv ?? 0), items: Number(p.items ?? 0),
    })),
    ...(live ? { live } : {}),
  };
}

const sum = (rows: Record<string, unknown>[], key: string): number =>
  rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

/**
 * Live-session detail for one participant, or null when they have no countable
 * session yet (R41: only verified/confirmed_manual sessions exist for a report).
 * Pure reads + sums of stored columns — no re-derivation of anything the upload
 * pipeline already computed, and no LLM anywhere (CLAUDE.md #1/#4).
 */
async function buildLiveDetail(
  supabase: SupabaseClient,
  projectId: number,
  creatorId: string
): Promise<ProjectReportLive | null> {
  const { data: sessionRows } = await supabase
    .from("project_live_sessions")
    .select(
      "id, session_date, session_no, brand, start_time, end_time, duration_min, gmv, gmv_trend, orders, items, customers, views, viewers_peak, impressions_live, product_impressions, product_clicks, add_to_cart"
    )
    .eq("project_id", projectId).eq("creator_id", creatorId)
    .in("attribution_status", ["verified", "confirmed_manual"])
    .order("session_date").order("session_no");

  const sessions = sessionRows ?? [];
  if (sessions.length === 0) return null;

  const { data: intervalRows } = await supabase
    .from("project_live_intervals")
    .select("session_id, time, gmv, viewers, likes, comments, shares, new_followers")
    .in("session_id", sessions.map((s) => s.id))
    .order("session_id").order("time");
  const intervals = intervalRows ?? [];

  const gmv = sum(sessions, "gmv");
  const orders = sum(sessions, "orders");
  const views = sum(sessions, "views");
  const productImpressions = sum(sessions, "product_impressions");
  const productClicks = sum(sessions, "product_clicks");

  // impressions_live is null on sessions uploaded before it was parsed; a report
  // must say "unknown" there rather than draw a zero bar at the top of the funnel.
  const impressionRows = sessions.filter((s) => s.impressions_live !== null);

  const times = (key: "start_time" | "end_time") =>
    sessions.map((s) => s[key]).filter((t): t is string => Boolean(t)).map((t) => t.slice(0, 5)).sort();
  const startTimes = times("start_time");
  const endTimes = times("end_time");

  const dates = [...new Set(sessions.map((s) => s.session_date as string))].sort();
  const sessionDate = new Map(sessions.map((s) => [s.id, s.session_date as string]));
  const singleDay = dates.length <= 1;

  const gmvTrend = sessions.some((s) => s.gmv_trend !== null) ? sum(sessions, "gmv_trend") : null;

  const live: ProjectReportLive = {
    sessions: sessions.length,
    brands: [...new Set(sessions.map((s) => s.brand).filter((b): b is string => Boolean(b)))],
    first_date: dates[0] ?? null,
    last_date: dates[dates.length - 1] ?? null,
    start_time: startTimes[0] ?? null,
    end_time: endTimes[endTimes.length - 1] ?? null,
    duration_min: sum(sessions, "duration_min"),
    gmv,
    orders,
    items: sum(sessions, "items"),
    customers: sum(sessions, "customers"),
    views,
    viewers_peak: sessions.reduce((max, s) => Math.max(max, Number(s.viewers_peak ?? 0)), 0),
    impressions_live: impressionRows.length > 0 ? sum(impressionRows, "impressions_live") : null,
    product_impressions: productImpressions,
    product_clicks: productClicks,
    add_to_cart: sum(sessions, "add_to_cart"),
    likes: sum(intervals, "likes"),
    comments: sum(intervals, "comments"),
    shares: sum(intervals, "shares"),
    new_followers: sum(intervals, "new_followers"),
    ctr: productImpressions > 0 ? productClicks / productImpressions : null,
    ctor: productClicks > 0 ? orders / productClicks : null,
    gpm: views > 0 ? (gmv / views) * 1000 : null,
    gmv_trend: gmvTrend,
    gmv_trend_diff: gmvTrend === null ? null : gmvTrend - gmv,
    timeline: intervals.map((i) => ({
      // One session reads as a clock; several days need the date to stay readable.
      label: singleDay ? String(i.time) : `${(sessionDate.get(i.session_id) ?? "").slice(5)} ${i.time}`,
      gmv: Number(i.gmv ?? 0),
      viewers: i.viewers === null ? null : Number(i.viewers),
    })),
    notes: [],
  };

  return { ...live, notes: buildLiveNotes(live) };
}

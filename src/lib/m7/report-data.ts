/**
 * M7 v2 Special Project — report peserta `data_json` builder (PRD §6.8, K5).
 * Rank and cohort averages are read from `project_creator_report_v`, computed
 * IN SQL (window functions) — this file only shapes what the view/queries
 * already computed into the JSON contract; it never re-aggregates raw rows
 * (CLAUDE.md #4: one source of truth) and never calls an LLM.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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
  };
}

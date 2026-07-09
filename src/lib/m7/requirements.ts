import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Special-project (M7) requirements surfaced into the M8 team workspaces so each
 * team sees what an active/planned project needs of them and how far along it is.
 * Read-only aggregation of special_projects + project_participants — the project
 * is the single source of truth (CLAUDE.md #4), workspaces never recompute it.
 */
export interface ProjectRequirement {
  id: number;
  name: string;
  type: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  targetGmv: number | null;
  /** How many creators the project needs (null = unspecified). */
  targetCreators: number | null;
  /** Creators already bound to the project. */
  participants: number;
  /** Remaining creators to recruit (0 when target met/unspecified). */
  creatorGap: number;
  /** Ads budget the project needs BizDev to secure/allocate. */
  adsBudgetCap: number | null;
}

/** Active + planned projects only — finished ones have no outstanding needs. */
export async function getProjectRequirements(
  supabase: SupabaseClient
): Promise<ProjectRequirement[]> {
  const { data: projects } = await supabase
    .from("special_projects")
    .select("id, name, type, start_date, end_date, target_gmv, target_creators, ads_budget_cap, status")
    .in("status", ["planning", "aktif"])
    .order("start_date", { ascending: true })
    .limit(50);
  if (!projects || projects.length === 0) return [];

  const counts = new Map<number, number>();
  const { data: parts } = await supabase
    .from("project_participants")
    .select("project_id")
    .in("project_id", projects.map((p) => p.id));
  for (const pt of parts ?? []) {
    counts.set(pt.project_id, (counts.get(pt.project_id) ?? 0) + 1);
  }

  return projects.map((p) => {
    const participants = counts.get(p.id) ?? 0;
    const target = p.target_creators ?? null;
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
      startDate: p.start_date,
      endDate: p.end_date,
      targetGmv: p.target_gmv,
      targetCreators: target,
      participants,
      creatorGap: target ? Math.max(target - participants, 0) : 0,
      adsBudgetCap: p.ads_budget_cap,
    };
  });
}

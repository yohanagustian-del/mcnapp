import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProjectReportData } from "../report-data";

type MockResult = { data?: unknown };

function makeQuery(result: MockResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "order", "limit"]) builder[m] = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  builder.single = () => Promise.resolve(result);
  builder.then = (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabase(resultsByTable: Record<string, MockResult>): SupabaseClient {
  return { from: (table: string) => makeQuery(resultsByTable[table] ?? { data: [] }) } as unknown as SupabaseClient;
}

const PROJECT = {
  id: 9, name: "Bootcamp Beauty & Personal Care", type: "bootcamp",
  start_date: "2026-09-01", end_date: "2026-09-30", target_gmv: 25_000_000,
};
const CREATOR = { id: "CRT-001", name: "glowbyrara", level: 3, niche: "Beauty" };

describe("buildProjectReportData", () => {
  it("shapes the full data_json per §6.8, using rank/cohort straight from the view", async () => {
    const sb = mockSupabase({
      special_projects: { data: PROJECT },
      creators: { data: CREATOR },
      project_participants: { data: { target_gmv: 833_333 } },
      project_creator_report_v: {
        data: {
          gmv: 2_310_000, live_gmv: 947_000, video_gmv: 1_363_000, orders: 41, items: 52,
          active_days: 19, live_share: 0.41, rank: 3, of: 28, project_total_gmv: 23_800_000,
          cohort_avg_gmv: 767_000, cohort_avg_live_share: 0.18, cohort_avg_active_days: 11,
        },
      },
      project_creator_metrics: { data: [{ date: "2026-09-01", gmv_actual: 0 }, { date: "2026-09-02", gmv_actual: 150_000 }] },
      project_creator_products: { data: [{ product_name: "Serum X", gmv: 1_100_000, items: 22 }] },
    });

    const result = await buildProjectReportData(sb, 9, "CRT-001");

    expect(result.period).toEqual({
      type: "project", start: "2026-09-01", end: "2026-09-30",
      project_id: 9, project_name: "Bootcamp Beauty & Personal Care", project_type: "bootcamp",
    });
    expect(result.creator).toEqual({ id: "CRT-001", name: "glowbyrara", level: 3, niche: "Beauty" });
    expect(result.target).toEqual({ personal_gmv: 833_333, project_gmv: 25_000_000 });
    expect(result.metrics.gmv).toBe(2_310_000);
    expect(result.metrics.aov).toBeCloseTo(2_310_000 / 41);
    expect(result.achievement.rank).toBe(3);
    expect(result.achievement.of).toBe(28);
    expect(result.achievement.personal_pct).toBeCloseTo(2_310_000 / 833_333);
    expect(result.achievement.share_of_project).toBeCloseTo(2_310_000 / 23_800_000);
    expect(result.cohort_avg).toEqual({ gmv: 767_000, live_share: 0.18, active_days: 11 });
    expect(result.daily).toEqual([{ date: "2026-09-01", gmv: 0 }, { date: "2026-09-02", gmv: 150_000 }]);
    expect(result.top_products).toEqual([{ name: "Serum X", gmv: 1_100_000, items: 22 }]);
  });

  it("R29: a participant with zero activity (no row in the view at all) still gets a report", async () => {
    const sb = mockSupabase({
      special_projects: { data: PROJECT },
      creators: { data: CREATOR },
      project_participants: { data: { target_gmv: 500_000 } },
      project_creator_report_v: { data: null },
      project_creator_metrics: { data: [] },
      project_creator_products: { data: [] },
    });

    const result = await buildProjectReportData(sb, 9, "CRT-001");
    expect(result.metrics.gmv).toBe(0);
    expect(result.metrics.aov).toBe(0);
    expect(result.achievement.personal_pct).toBe(0);
    expect(result.achievement.share_of_project).toBe(0);
    expect(result.daily).toEqual([]);
    expect(result.top_products).toEqual([]);
  });

  it("throws when the creator isn't a participant of the project", async () => {
    const sb = mockSupabase({
      special_projects: { data: PROJECT },
      creators: { data: CREATOR },
      project_participants: { data: null },
    });
    await expect(buildProjectReportData(sb, 9, "CRT-001")).rejects.toThrow(/bukan peserta/);
  });
});

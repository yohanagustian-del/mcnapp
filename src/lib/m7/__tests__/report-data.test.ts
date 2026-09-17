import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProjectReportData } from "../report-data";

type MockResult = { data?: unknown };

function makeQuery(result: MockResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "in", "order", "limit"]) builder[m] = chain;
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
const CREATOR = { id: "CRT-001", name: "Rara Glow", username: "glowbyrara", level: 3, niche: "Beauty" };

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
    expect(result.creator).toEqual({ id: "CRT-001", name: "Rara Glow", username: "glowbyrara", level: 3, niche: "Beauty" });
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

  it("omits the live block entirely when the participant has no countable session", async () => {
    const sb = mockSupabase({
      special_projects: { data: PROJECT },
      creators: { data: CREATOR },
      project_participants: { data: { target_gmv: 500_000 } },
      project_creator_report_v: { data: null },
      project_live_sessions: { data: [] },
    });
    const result = await buildProjectReportData(sb, 9, "CRT-001");
    expect(result.live).toBeUndefined();
  });

  // Angka di bawah = sesi live nyata yang dipakai QA produksi 2026-09-17
  // (export LIVE Center, 5 interval 30 menit).
  describe("live detail (PRD addendum §9/§10.4)", () => {
    const SESSION = {
      id: 1, session_date: "2026-09-17", session_no: 1, brand: "OMG Oh My Glam",
      start_time: "08:54:00", end_time: "10:54:00", duration_min: 120,
      gmv: 338_887, gmv_trend: 338_887, orders: 10, items: 11, customers: 10,
      views: 908, viewers_peak: 9, impressions_live: 15_051,
      product_impressions: 2_763, product_clicks: 149, add_to_cart: 7,
    };
    const INTERVALS = [
      { session_id: 1, time: "08:54", gmv: 0, viewers: 7, likes: 483, comments: 12, shares: 1, new_followers: 0 },
      { session_id: 1, time: "09:24", gmv: 131_821, viewers: 6, likes: 745, comments: 18, shares: 1, new_followers: 0 },
      { session_id: 1, time: "09:54", gmv: 207_066, viewers: 9, likes: 1_134, comments: 40, shares: 0, new_followers: 1 },
    ];

    // Baris file Product yang disimpan sejak migrasi 0062 — sumber "Produk terlaris".
    const PRODUCTS = [
      { product_id: "P1", product_name: "Mattelast Lip Cream", gmv: 208_857, items: 7, orders: 6, product_impressions: 900, product_clicks: 84 },
      { product_id: "P2", product_name: "Colorlast Lip Vinyl", gmv: 49_157, items: 1, orders: 1, product_impressions: 400, product_clicks: 34 },
      { product_id: "P3", product_name: "Complete Makeup Look Set", gmv: 0, items: 0, orders: 0, product_impressions: 74, product_clicks: 0 },
      { product_id: "P4", product_name: "Brow Pensil", gmv: 0, items: 0, orders: 0, product_impressions: 20, product_clicks: 1 },
    ];

    const sbWithLive = (session: Record<string, unknown> = SESSION) =>
      mockSupabase({
        special_projects: { data: PROJECT },
        creators: { data: CREATOR },
        project_participants: { data: { target_gmv: 500_000 } },
        project_creator_report_v: { data: null },
        project_live_sessions: { data: [session] },
        project_live_intervals: { data: INTERVALS },
        project_live_session_products: { data: PRODUCTS },
      });

    it("sums session totals and derives ctr/ctor/gpm from them", async () => {
      const { live } = await buildProjectReportData(sbWithLive(), 9, "CRT-001");
      expect(live).toBeDefined();
      expect(live!.sessions).toBe(1);
      expect(live!.brands).toEqual(["OMG Oh My Glam"]);
      expect(live!.start_time).toBe("08:54");
      expect(live!.end_time).toBe("10:54");
      expect(live!.gmv).toBe(338_887);
      expect(live!.customers).toBe(10);
      expect(live!.impressions_live).toBe(15_051);
      expect(live!.ctr).toBeCloseTo(149 / 2_763);
      expect(live!.ctor).toBeCloseTo(10 / 149);
      expect(live!.gpm).toBeCloseTo((338_887 / 908) * 1000);
    });

    it("takes the interaction counts from the intervals — the session columns don't carry them", async () => {
      const { live } = await buildProjectReportData(sbWithLive(), 9, "CRT-001");
      expect(live!.likes).toBe(483 + 745 + 1_134);
      expect(live!.comments).toBe(12 + 18 + 40);
      expect(live!.shares).toBe(2);
      expect(live!.new_followers).toBe(1);
    });

    it("labels the timeline with the clock only while every session is on one day", async () => {
      const { live } = await buildProjectReportData(sbWithLive(), 9, "CRT-001");
      expect(live!.timeline).toEqual([
        { label: "08:54", gmv: 0, viewers: 7 },
        { label: "09:24", gmv: 131_821, viewers: 6 },
        { label: "09:54", gmv: 207_066, viewers: 9 },
      ]);
    });

    it("reports impressions_live as null (not 0) for sessions uploaded before it was parsed", async () => {
      const { live } = await buildProjectReportData(sbWithLive({ ...SESSION, impressions_live: null }), 9, "CRT-001");
      expect(live!.impressions_live).toBeNull();
    });

    it("ranks the session's own products and counts the etalase around them", async () => {
      const { live } = await buildProjectReportData(sbWithLive(), 9, "CRT-001");
      expect(live!.products).toEqual([
        { name: "Mattelast Lip Cream", gmv: 208_857, items: 7, clicks: 84 },
        { name: "Colorlast Lip Vinyl", gmv: 49_157, items: 1, clicks: 34 },
      ]);
      expect(live!.products_total).toBe(4);
      expect(live!.products_sold).toBe(2);
      // Yang paling sering tampil tapi nol pesanan — bukan sekadar yang pertama.
      expect(live!.top_unsold).toEqual({ name: "Complete Makeup Look Set", impressions: 74 });
      expect(live!.items_per_order).toBeCloseTo(11 / 10);
      expect(live!.session_no).toBe(1);
    });

    // Permintaan tim 2026-09-17: kreator ingin membaca performa PER HARI, bukan
    // hanya angka gabungan seluruh project.
    describe("pecahan per hari (live_days)", () => {
      const DAY2 = {
        ...SESSION, id: 2, session_date: "2026-09-18", session_no: 1,
        gmv: 100_000, gmv_trend: 100_000, orders: 4, items: 5, customers: 4,
        views: 300, viewers_peak: 5, impressions_live: 900,
        product_impressions: 400, product_clicks: 20, add_to_cart: 3,
      };
      const DAY2_INTERVALS = [
        { session_id: 2, time: "20:00", gmv: 100_000, viewers: 5, likes: 10, comments: 2, shares: 0, new_followers: 1 },
      ];

      const sbTwoDays = () =>
        mockSupabase({
          special_projects: { data: PROJECT },
          creators: { data: CREATOR },
          project_participants: { data: { target_gmv: 500_000 } },
          project_creator_report_v: { data: null },
          project_live_sessions: { data: [SESSION, DAY2] },
          project_live_intervals: { data: [...INTERVALS, ...DAY2_INTERVALS] },
          project_live_session_products: { data: PRODUCTS.map((p) => ({ ...p, session_id: 1 })) },
        });

      it("memecah satu report per hari sesi, berurutan", async () => {
        const { live_days } = await buildProjectReportData(sbTwoDays(), 9, "CRT-001");
        expect(live_days).toHaveLength(2);
        expect(live_days!.map((d) => d.first_date)).toEqual(["2026-09-17", "2026-09-18"]);
        expect(live_days!.every((d) => d.first_date === d.last_date)).toBe(true);
      });

      it("tiap hari hanya memuat angka hari itu, dan gabungannya tetap totalnya", async () => {
        const { live, live_days } = await buildProjectReportData(sbTwoDays(), 9, "CRT-001");
        expect(live_days![0].gmv).toBe(338_887);
        expect(live_days![1].gmv).toBe(100_000);
        expect(live!.gmv).toBe(338_887 + 100_000);
        // Interval hari kedua tidak boleh bocor ke timeline hari pertama.
        expect(live_days![0].timeline).toHaveLength(INTERVALS.length);
        expect(live_days![1].timeline).toEqual([{ label: "20:00", gmv: 100_000, viewers: 5 }]);
      });

      it("memecah produk per hari — hari tanpa baris produk tidak meminjam milik hari lain", async () => {
        const { live_days } = await buildProjectReportData(sbTwoDays(), 9, "CRT-001");
        expect(live_days![0].products_total).toBe(4);
        expect(live_days![1].products_total).toBe(0);
      });

      it("tidak memecah apa pun untuk project satu hari — `live` sudah harinya", async () => {
        const { live, live_days } = await buildProjectReportData(sbWithLive(), 9, "CRT-001");
        expect(live).toBeDefined();
        expect(live_days).toBeUndefined();
      });
    });

    it("flags a Product vs Trend Stats GMV gap, and stays silent when they agree", async () => {
      const same = await buildProjectReportData(sbWithLive(), 9, "CRT-001");
      expect(same.live!.gmv_trend_diff).toBe(0);

      const off = await buildProjectReportData(sbWithLive({ ...SESSION, gmv_trend: 342_927 }), 9, "CRT-001");
      expect(off.live!.gmv_trend_diff).toBe(4_040);
    });
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

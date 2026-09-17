import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshCreatorReportData } from "../report-refresh";

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

const PROJECT = {
  id: 13, name: "KLS BAU 15-19", type: "bootcamp",
  start_date: "2026-09-15", end_date: "2026-09-19", target_gmv: 50_000_000,
};
const CREATOR = { id: "CRT-S3F5E", name: "Sari", username: "sari", level: 4, niche: "Beauty" };

/** Sesi 15 DAN 16 September — keadaan setelah upload hari kedua. */
const SESSIONS = [
  {
    id: 1, session_date: "2026-09-15", session_no: 1, brand: "BAU", start_time: "10:00:00",
    end_time: "12:00:00", duration_min: 120, gmv: 6_122_613, gmv_trend: 6_122_613, orders: 113,
    items: 120, customers: 100, views: 9000, viewers_peak: 40, impressions_live: 20_000,
    product_impressions: 5000, product_clicks: 300, add_to_cart: 40,
  },
  {
    id: 2, session_date: "2026-09-16", session_no: 1, brand: "BAU", start_time: "10:00:00",
    end_time: "12:00:00", duration_min: 120, gmv: 1_449_367, gmv_trend: 1_449_367, orders: 24,
    items: 30, customers: 20, views: 3000, viewers_peak: 15, impressions_live: 6000,
    product_impressions: 1200, product_clicks: 90, add_to_cart: 10,
  },
];

interface Captured { id: number; patch: Record<string, unknown> }

function mockClient(reportRows: { id: number; status: string }[], captured: Captured[]) {
  const tables: Record<string, MockResult> = {
    special_projects: { data: PROJECT },
    creators: { data: CREATOR },
    project_participants: { data: { target_gmv: 10_000_000 } },
    project_creator_report_v: { data: null },
    project_creator_metrics: {
      data: [
        { date: "2026-09-15", gmv_actual: 6_122_613 },
        { date: "2026-09-16", gmv_actual: 1_449_367 },
      ],
    },
    project_creator_products: { data: [] },
    project_live_sessions: { data: SESSIONS },
    project_live_intervals: { data: [] },
    project_live_session_products: { data: [] },
  };

  return {
    from(table: string) {
      if (table !== "creator_reports") return makeQuery(tables[table] ?? { data: [] });
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "eq"]) builder[m] = chain;
      builder.in = () => Promise.resolve({ data: reportRows });
      builder.update = (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: number) => {
          captured.push({ id, patch });
          return Promise.resolve({ error: null });
        },
      });
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("refreshCreatorReportData (temuan QA produksi 2026-09-17)", () => {
  it("menyegarkan angka report FINAL — inilah baris yang benar-benar dilihat kreator", async () => {
    const captured: Captured[] = [];
    const n = await refreshCreatorReportData(mockClient([{ id: 7, status: "final" }], captured), 13, "CRT-S3F5E");

    expect(n).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].id).toBe(7);

    // Sesi 16 September ikut terhitung — persis yang hilang sebelum perbaikan ini.
    const data = captured[0].patch.data_json as { live?: { sessions: number; first_date: string; last_date: string } };
    expect(data.live?.sessions).toBe(2);
    expect(data.live?.first_date).toBe("2026-09-15");
    expect(data.live?.last_date).toBe("2026-09-16");
  });

  it("tidak pernah menyentuh narasi maupun status — finalisasi mengatur narasi, bukan membekukan angka (R28)", async () => {
    const captured: Captured[] = [];
    await refreshCreatorReportData(mockClient([{ id: 7, status: "final" }], captured), 13, "CRT-S3F5E");

    expect(Object.keys(captured[0].patch).sort()).toEqual(["data_json", "generated_at"]);
  });

  it("menyegarkan draft dan final sekaligus saat keduanya ada", async () => {
    const captured: Captured[] = [];
    const n = await refreshCreatorReportData(
      mockClient([{ id: 7, status: "final" }, { id: 9, status: "draft" }], captured), 13, "CRT-S3F5E"
    );

    expect(n).toBe(2);
    expect(captured.map((c) => c.id).sort()).toEqual([7, 9]);
  });

  it("tidak membuat report baru untuk peserta yang memang belum pernah di-generate", async () => {
    const captured: Captured[] = [];
    const n = await refreshCreatorReportData(mockClient([], captured), 13, "CRT-S3F5E");

    expect(n).toBe(0);
    expect(captured).toEqual([]);
  });
});

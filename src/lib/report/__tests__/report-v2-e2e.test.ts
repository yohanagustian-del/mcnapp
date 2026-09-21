import { describe, expect, it } from "vitest";
import {
  analyzeLiveSessionGroups, groupUploadedFiles, persistLiveSessions, type LiveSessionOwner,
} from "@/lib/m7/live-ingest";
import { buildLiveSampleFiles, defaultSampleSpec } from "@/lib/m7/live-sample";
import { createFakeSupabase, type FakeDb } from "@/lib/m7/__tests__/helpers/fake-supabase";
import { buildCreatorReportData } from "../build";
import { DEFAULT_BENCHMARK, DEFAULT_REPORT_RULES } from "../rules";

/**
 * Report Kreator (M2) v2 dari ujung ke ujung: agregat mingguan yang sudah ada +
 * sesi live yang BENAR-BENAR diunggah lewat jalur Jadwal Live (file .xlsx
 * sungguhan, bukan baris sesi yang ditanam langsung).
 *
 * Yang dijaga di sini adalah dua keputusan yang paling mudah rusak diam-diam:
 *  1. report bulanan MENJUMLAH seluruh minggu (dulu hanya satu minggu terbaru),
 *  2. seksi live HANYA membaca sesi milik Jadwal Live, bukan Special Project.
 */

const CREATOR_ID = "CRT-001";
const SLOT_ID = 77;
const SLOT_DATE = "2026-09-17";
const ACTOR = "00000000-0000-0000-0000-000000000001";

const week = (periodStart: string, over: Record<string, unknown> = {}) => ({
  creator_id: CREATOR_ID,
  period_start: periodStart,
  created_at: `${periodStart}T00:00:00Z`,
  gmv_total: 10_000_000,
  affiliate_gmv: 10_000_000,
  affiliate_live_gmv: 7_000_000,
  affiliate_video_gmv: 3_000_000,
  direct_gmv: 0,
  orders: 100,
  live_orders: 70,
  video_orders: 30,
  items_sold: 120,
  ctr: 0.05,
  ctor: 0.03,
  ...over,
});

const product = (productId: string, over: Record<string, unknown> = {}) => ({
  creator_id: CREATOR_ID,
  period_start: "2026-09-01",
  product_id: productId,
  product_info: `Produk ${productId}`,
  shop_name: "Toko Glow",
  level1_category: "Beauty",
  level2_category: "Skincare",
  gmv: 1_000_000,
  orders: 10,
  live_gmv: 800_000,
  video_gmv: 200_000,
  items_sold: 12,
  live_orders: 8,
  video_orders: 2,
  direct_gmv: 0,
  ctr: 0.05,
  ctor: 0.03,
  ...over,
});

function seedDb(extra: Record<string, Record<string, unknown>[]> = {}): FakeDb {
  return createFakeSupabase({
    creators: [
      { id: CREATOR_ID, name: "Rara Glow", username: "tesakun", level: 3, niche: "Beauty", contract_end_date: null },
      { id: "CRT-002", name: "Peer Satu", username: "peer1", level: 2, niche: "Beauty", contract_end_date: null },
    ],
    creator_username_aliases: [],
    live_schedule_slots: [{
      id: SLOT_ID, creator_id: CREATOR_ID, schedule_date: SLOT_DATE,
      start_time: "19:00:00", end_time: "22:00:00",
      actual_start: null, actual_end: null, brand_name: "Glow Beauty", status: "done",
    }],
    project_live_sessions: [],
    project_live_session_products: [],
    project_live_intervals: [],
    creator_period_summary: [
      // Empat minggu September untuk kreator yang direport…
      week("2026-09-01"), week("2026-09-08"), week("2026-09-15"), week("2026-09-22"),
      // …satu minggu Agustus sebagai pembanding periode lalu…
      week("2026-08-01", { affiliate_gmv: 20_000_000, affiliate_live_gmv: 14_000_000, affiliate_video_gmv: 6_000_000, orders: 200 }),
      // …dan dua minggu milik PEER (benchmark anonim, sumbernya tabel yang sama).
      { ...week("2026-09-01"), creator_id: "CRT-002", affiliate_gmv: 5_000_000 },
      { ...week("2026-09-08"), creator_id: "CRT-002", affiliate_gmv: 5_000_000 },
    ],
    creator_top_products: [
      product("P-1", { gmv: 3_000_000, live_gmv: 2_800_000, video_gmv: 200_000, ctr: 0.09, ctor: 0.02, items_sold: 30 }),
      product("P-2", { gmv: 2_000_000, live_gmv: 200_000, video_gmv: 1_800_000, ctr: 0.03, ctor: 0.08, items_sold: 40 }),
    ],
    creator_subcat_segment_gmv: [
      { creator_id: CREATOR_ID, level2_category: "Skincare", gmv: 30_000_000, window_end: "2026-09-30" },
      { creator_id: CREATOR_ID, level2_category: "Makeup", gmv: 10_000_000, window_end: "2026-09-30" },
    ],
    creator_link_status: [],
    ...extra,
  });
}

/** Unggah satu sesi live sungguhan ke slot (atau ke project, untuk uji isolasi). */
async function uploadSession(db: FakeDb, owner: LiveSessionOwner) {
  const spec = defaultSampleSpec({ date: SLOT_DATE });
  const files = buildLiveSampleFiles(spec).map((f) => new File([f.data as BlobPart], f.name));
  const { groups } = await groupUploadedFiles(files);
  const analyzed = await analyzeLiveSessionGroups(db.client, owner, CREATOR_ID, groups, 0.02);
  return persistLiveSessions(db.client, owner, CREATOR_ID, analyzed, {
    actorId: ACTOR, brand: "Glow Beauty", overrides: {},
  });
}

const buildMonthly = (db: FakeDb) =>
  buildCreatorReportData(db.client, {
    creatorId: CREATOR_ID, periodType: "monthly", periodStart: "2026-09-01",
    rules: DEFAULT_REPORT_RULES, benchmarks: { default: DEFAULT_BENCHMARK },
  });

describe("Report Kreator v2 — bulanan", () => {
  it("MENJUMLAH seluruh minggu dalam bulan, bukan mengambil satu (bug audit #1)", async () => {
    const data = await buildMonthly(seedDb());
    expect(data.period.weeks_counted).toBe(4);
    expect(data.metrics.gmv).toBe(40_000_000); // 4 × 10jt, bukan 10jt
    expect(data.metrics.orders).toBe(400);
    expect(data.metrics.live_gmv).toBe(28_000_000);
    expect(data.metrics.aov).toBe(100_000);
  });

  it("baris minggu yang di-upload ulang memakai yang TERBARU, bukan menjumlah keduanya", async () => {
    const db = seedDb();
    db.rows("creator_period_summary").push(
      week("2026-09-01", { created_at: "2026-09-30T00:00:00Z", affiliate_gmv: 1_000_000, orders: 5 })
    );
    const data = await buildMonthly(db);
    expect(data.period.weeks_counted).toBe(4);
    // Minggu pertama kini 1jt (koreksi), tiga sisanya 10jt.
    expect(data.metrics.gmv).toBe(31_000_000);
  });

  it("membandingkan dengan periode lalu dan menghitung delta", async () => {
    const data = await buildMonthly(seedDb());
    expect(data.previous.gmv).toBe(20_000_000);
    expect(data.deltas.gmv).toBeCloseTo(1); // 20jt → 40jt = +100%
  });

  it("benchmark peer terisi dari creator_period_summary (bug audit #2 — dulu selalu null)", async () => {
    const data = await buildMonthly(seedDb());
    expect(data.benchmark).not.toBeNull();
    expect(data.benchmark).toMatchObject({ niche: "Beauty", peers: 1, peer_avg_gmv: 10_000_000 });
  });

  it("produk dipisah live vs video, dengan badge deterministik", async () => {
    const data = await buildMonthly(seedDb());
    expect(data.products.split_unavailable).toBe(false);
    expect(data.products.top_live[0].product_id).toBe("P-1");
    expect(data.products.top_video[0].product_id).toBe("P-2");
    expect(data.products.top_live.find((p) => p.product_id === "P-1")!.badges).toContain("CTR terbaik");
    expect(data.products.top_live.find((p) => p.product_id === "P-2")!.badges).toContain("CTOR champion");
  });

  it("batch lama tanpa pecahan live/video mengaku belum punya datanya, bukan menampilkan nol", async () => {
    const db = seedDb({
      creator_top_products: [
        product("P-1", { live_gmv: 0, video_gmv: 0 }),
        product("P-2", { live_gmv: 0, video_gmv: 0 }),
      ],
    });
    const data = await buildMonthly(db);
    expect(data.products.split_unavailable).toBe(true);
    expect(data.products.top_video).toEqual([]);
    expect(data.data_notes.join(" ")).toMatch(/belum tersedia untuk periode ini/i);
  });

  it("seluruh kalimat report terbentuk tanpa LLM", async () => {
    const data = await buildMonthly(seedDb());
    expect(data.schema_version).toBe(2);
    expect(data.summary).toContain("GMV");
    expect(data.insights.length).toBeGreaterThan(0);
    expect(data.recommendations.length).toBeGreaterThan(0);
    // Tidak ada kalimat yang menyebut angka di luar data — periksa satu yang paling rawan.
    expect(data.insights.find((i) => i.key === "gmv_trend")!.text).toContain("Rp40,0 jt");
  });
});

describe("Report Kreator v2 — seksi live", () => {
  it("membaca sesi yang diunggah lewat Jadwal Live", async () => {
    const db = seedDb();
    const saved = await uploadSession(db, { kind: "slot", slotId: SLOT_ID, scheduleDate: SLOT_DATE });
    expect(saved.saved).toHaveLength(1);

    const data = await buildMonthly(db);
    expect(data.live.available).toBe(true);
    expect(data.live.sessions).toBe(1);
    expect(data.live.gmv).toBe(3_300_000);
    expect(data.live.duration_total_min).toBe(120);
    expect(data.live.gmv_per_hour).toBe(1_650_000);
    expect(data.live.best_start_hour).toBe(19);
    expect(data.live.benchmarks.map((b) => b.key)).toEqual(["cvr", "err", "gpm", "ctr", "ctor"]);
    // Cakupan jujur: GMV live platform 28jt, yang file sesinya ada baru 3,3jt.
    expect(data.live.platform_live_gmv).toBe(28_000_000);
    expect(data.live.coverage_ratio).toBeCloseTo(3_300_000 / 28_000_000);
    expect(data.insights.map((i) => i.key)).toContain("live_coverage");
  });

  it("membedah sesi terbaik lengkap dengan linimasa, produk, dan catatan", async () => {
    const db = seedDb();
    await uploadSession(db, { kind: "slot", slotId: SLOT_ID, scheduleDate: SLOT_DATE });
    const data = await buildMonthly(db);

    expect(data.live_deep_dive).toHaveLength(1);
    const dd = data.live_deep_dive[0];
    expect(dd.timeline).toHaveLength(5);
    expect(dd.top_products[0].name).toBe("Serum Glow 30ml");
    expect(dd.notes.length).toBeGreaterThan(0);
    expect(dd.benchmarks).toHaveLength(5);
  });

  it("sesi milik Special Project TIDAK ikut (keputusan user 2026-09-21)", async () => {
    const db = seedDb();
    const saved = await uploadSession(db, {
      kind: "project", projectId: 13, startDate: "2026-09-01", endDate: "2026-09-30",
    });
    expect(saved.saved).toHaveLength(1); // tersimpan, tapi milik project

    const data = await buildMonthly(db);
    expect(data.live.available).toBe(false);
    expect(data.live.sessions).toBe(0);
    expect(data.live_deep_dive).toEqual([]);
    expect(data.insights.map((i) => i.key)).toContain("live_no_session");
  });

  it("tanpa sesi live sama sekali, report tetap terbentuk dan mengaku apa adanya", async () => {
    const data = await buildMonthly(seedDb());
    expect(data.live.available).toBe(false);
    const box = data.insights.find((i) => i.key === "live_no_session")!;
    expect(box.text).toMatch(/belum diunggah/i);
    expect(data.recommendations.map((r) => r.key)).not.toContain("schedule_best_hour");
  });
});

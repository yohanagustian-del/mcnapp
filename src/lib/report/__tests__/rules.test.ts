import { describe, expect, it } from "vitest";
import {
  assignProductBadges, benchmarkStatus, buildBenchmarkRows, buildDataNotes, buildInsights,
  buildRecommendations, buildSummary, DEFAULT_BENCHMARK, DEFAULT_REPORT_RULES, pickBenchmark,
  type LiveBenchmarks, type RulesInput,
} from "../rules";
import type { ReportKpi, ReportLive, ReportProduct } from "../types";

const BENCHMARKS: LiveBenchmarks = {
  default: DEFAULT_BENCHMARK,
  beauty: { cvr: 0.053, err: 0.02, gpm: 5000, ctr: 0.06, ctor: 0.03 },
};

const kpi = (over: Partial<ReportKpi> = {}): ReportKpi => ({
  gmv: 10_000_000, live_gmv: 9_000_000, video_gmv: 1_000_000, direct_gmv: 0,
  orders: 100, live_orders: 90, video_orders: 10, items: 120,
  aov: 100_000, live_share: 0.9, video_share: 0.1, ctr: 0.05, ctor: 0.03,
  ...over,
});

const live = (over: Partial<Omit<ReportLive, "benchmarks">> = {}): Omit<ReportLive, "benchmarks"> => ({
  available: true, sessions: 4, days: 4, duration_total_min: 720, duration_avg_min: 180,
  longest_session_min: 240, gmv: 9_000_000, orders: 90, items: 100, views: 30_000, viewers_peak: 400,
  gmv_per_session: 2_250_000, gmv_per_hour: 750_000, cvr: 0.003, err: 0.01, gpm: 300,
  ctr: 0.02, ctor: 0.01, by_start_hour: [], best_start_hour: 19, top_sessions: [],
  platform_live_gmv: 9_000_000, coverage_ratio: 1, ...over,
});

const product = (over: Partial<ReportProduct> = {}): ReportProduct => ({
  product_id: "P1", name: "Serum", shop_name: null, category: null,
  gmv: 1_000_000, live_gmv: 1_000_000, video_gmv: 0, orders: 10, items: 12,
  aov: 100_000, ctr: 0.05, ctor: 0.03, badges: [], ...over,
});

const input = (over: Partial<RulesInput> = {}): RulesInput => ({
  metrics: kpi(),
  previous: kpi({ gmv: 8_000_000 }),
  deltas: { gmv: 0.25, live_gmv: 0.2, video_gmv: 0.1, orders: 0.1, items: 0.1, aov: 0.05 },
  live: live(),
  benchmarks: buildBenchmarkRows(live(), DEFAULT_BENCHMARK),
  topLive: [product()],
  topVideo: [],
  rules: DEFAULT_REPORT_RULES,
  periodLabel: "Minggu 1–7 September 2026",
  ...over,
});

describe("pickBenchmark", () => {
  it("mencocokkan kata kunci niche tanpa peduli huruf besar/kecil", () => {
    expect(pickBenchmark(BENCHMARKS, "Beauty & Personal Care").cvr).toBe(0.053);
  });
  it("jatuh ke default untuk niche yang tidak terdaftar / kosong", () => {
    expect(pickBenchmark(BENCHMARKS, "Otomotif")).toEqual(DEFAULT_BENCHMARK);
    expect(pickBenchmark(BENCHMARKS, null)).toEqual(DEFAULT_BENCHMARK);
  });
});

describe("benchmarkStatus", () => {
  it("above / near / below / unknown", () => {
    expect(benchmarkStatus(0.04, 0.03)).toBe("above");
    expect(benchmarkStatus(0.025, 0.03)).toBe("near"); // ≥ 80%
    expect(benchmarkStatus(0.01, 0.03)).toBe("below");
    expect(benchmarkStatus(null, 0.03)).toBe("unknown");
  });
});

describe("buildBenchmarkRows", () => {
  it("selalu lima baris dengan urutan tetap dan satuan yang benar", () => {
    const rows = buildBenchmarkRows(live(), DEFAULT_BENCHMARK);
    expect(rows.map((r) => r.key)).toEqual(["cvr", "err", "gpm", "ctr", "ctor"]);
    expect(rows.find((r) => r.key === "gpm")?.unit).toBe("rupiah");
    expect(rows.find((r) => r.key === "cvr")?.status).toBe("below");
  });
});

describe("assignProductBadges", () => {
  it("satu pemenang per kriteria, dan badge tidak diberikan pada nilai null", () => {
    const rows = assignProductBadges([
      product({ product_id: "A", ctr: 0.09, ctor: 0.01, aov: 50_000, items: 5 }),
      product({ product_id: "B", ctr: 0.02, ctor: 0.08, aov: 200_000, items: 50 }),
      product({ product_id: "C", ctr: null, ctor: null, aov: null, items: 0 }),
    ]);
    expect(rows.find((r) => r.product_id === "A")?.badges).toEqual(["CTR terbaik"]);
    expect(rows.find((r) => r.product_id === "B")?.badges).toEqual(["CTOR champion", "AOV tertinggi", "Volume tinggi"]);
    expect(rows.find((r) => r.product_id === "C")?.badges).toEqual([]);
  });

  it("daftar satu produk tidak diberi badge (tidak memberi informasi)", () => {
    expect(assignProductBadges([product()])[0].badges).toEqual([]);
  });
});

describe("buildInsights", () => {
  it("menyebut tren GMV dari angka periode lalu yang sebenarnya", () => {
    const boxes = buildInsights(input());
    const tren = boxes.find((b) => b.key === "gmv_trend")!;
    expect(tren.tone).toBe("good");
    expect(tren.text).toContain("Rp8,0 jt");
    expect(tren.text).toContain("Rp10,0 jt");
  });

  it("GMV turun → nada bad", () => {
    const boxes = buildInsights(input({ deltas: { gmv: -0.3, live_gmv: null, video_gmv: null, orders: null, items: null, aov: null } }));
    expect(boxes.find((b) => b.key === "gmv_trend")?.tone).toBe("bad");
  });

  it("tanpa pembanding periode lalu, tidak mengarang tren", () => {
    const boxes = buildInsights(input({ deltas: { gmv: null, live_gmv: null, video_gmv: null, orders: null, items: null, aov: null } }));
    expect(boxes.find((b) => b.key === "gmv_trend")?.tone).toBe("info");
  });

  it("menandai durasi live di bawah target dan metrik di bawah benchmark", () => {
    const boxes = buildInsights(input());
    expect(boxes.find((b) => b.key === "live_duration")?.tone).toBe("warn");
    expect(boxes.find((b) => b.key === "live_benchmark_gap")).toBeDefined();
  });

  it("tanpa sesi live, mengaku belum ada datanya (bukan angka nol yang menipu)", () => {
    const boxes = buildInsights(input({ live: live({ available: false, sessions: 0, gmv: 0 }) }));
    const box = boxes.find((b) => b.key === "live_no_session")!;
    expect(box.text).toContain("belum diunggah");
    expect(boxes.find((b) => b.key === "live_duration")).toBeUndefined();
  });

  it("produk dengan CTR tinggi tapi CTOR jomplang ditandai", () => {
    const boxes = buildInsights(input({ topLive: [product({ ctr: 0.1, ctor: 0.01 })] }));
    expect(boxes.find((b) => b.key === "product_ctor_gap")).toBeDefined();
  });

  it("cakupan sesi di bawah 90% disebut sebagai catatan, bukan didiamkan", () => {
    const boxes = buildInsights(input({ live: live({ gmv: 4_000_000, platform_live_gmv: 9_000_000, coverage_ratio: 4 / 9 }) }));
    expect(boxes.find((b) => b.key === "live_coverage")).toBeDefined();
  });
});

describe("buildRecommendations", () => {
  it("memberi aksi konkret dari angka yang ada", () => {
    const recs = buildRecommendations(input());
    const keys = recs.map((r) => r.key);
    expect(keys).toContain("schedule_best_hour");
    expect(keys).toContain("extend_duration");
    expect(keys).toContain("improve_ctor");
    expect(keys).toContain("double_down_product");
  });

  it("tanpa sesi live, tidak menyarankan jam atau durasi", () => {
    const recs = buildRecommendations(input({ live: live({ available: false, best_start_hour: null, duration_avg_min: null }) }));
    const keys = recs.map((r) => r.key);
    expect(keys).not.toContain("schedule_best_hour");
    expect(keys).not.toContain("extend_duration");
  });
});

describe("buildSummary", () => {
  it("ringkasan memuat GMV, order, tren, komposisi, dan sesi", () => {
    const s = buildSummary(input());
    expect(s).toContain("GMV Rp10,0 jt");
    expect(s).toContain("100 order");
    expect(s).toContain("naik 25,0%");
    expect(s).toContain("4 sesi live");
  });
});

describe("buildDataNotes", () => {
  it("selalu menyebut metrik yang memang tidak ada di export", () => {
    expect(buildDataNotes({ liveAvailable: true, productSplitAvailable: true })).toHaveLength(1);
    expect(buildDataNotes({ liveAvailable: false, productSplitAvailable: false })).toHaveLength(3);
  });
});

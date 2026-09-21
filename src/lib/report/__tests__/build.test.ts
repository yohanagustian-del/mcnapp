import { describe, expect, it } from "vitest";
import {
  aggregateProducts, latestPerPeriod, periodLabel, productSplitAvailable, rankProducts,
  sumPeriodSummaries, type PeriodSummaryRowV2, type TopProductRowV2,
} from "../build";

const week = (over: Partial<PeriodSummaryRowV2> = {}): PeriodSummaryRowV2 => ({
  period_start: "2026-09-01", created_at: "2026-09-08T00:00:00Z",
  gmv_total: 1_000_000, affiliate_gmv: 1_000_000, affiliate_live_gmv: 800_000,
  affiliate_video_gmv: 200_000, direct_gmv: 0, orders: 10, live_orders: 8,
  video_orders: 2, items_sold: 12, ctr: 0.05, ctor: 0.03, ...over,
});

describe("latestPerPeriod (bug audit #1)", () => {
  it("mengembalikan SEMUA minggu, satu baris terbaru per period_start", () => {
    const rows = [
      week({ period_start: "2026-09-01", created_at: "2026-09-08T00:00:00Z", affiliate_gmv: 1 }),
      week({ period_start: "2026-09-01", created_at: "2026-09-09T00:00:00Z", affiliate_gmv: 2 }),
      week({ period_start: "2026-09-08", created_at: "2026-09-15T00:00:00Z", affiliate_gmv: 3 }),
    ];
    const out = latestPerPeriod(rows);
    expect(out).toHaveLength(2);
    expect(out.map((r) => Number(r.affiliate_gmv))).toEqual([2, 3]); // koreksi menang, urut tanggal
  });

  it("tanpa baris → kosong (bukan null yang bikin bulan cuma 1 minggu)", () => {
    expect(latestPerPeriod([])).toEqual([]);
  });
});

describe("sumPeriodSummaries", () => {
  it("MENJUMLAH minggu-minggu dalam periode, bukan mengambil satu", () => {
    const kpi = sumPeriodSummaries([
      week({ period_start: "2026-09-01" }),
      week({ period_start: "2026-09-08" }),
      week({ period_start: "2026-09-15" }),
      week({ period_start: "2026-09-22" }),
    ]);
    expect(kpi.gmv).toBe(4_000_000);
    expect(kpi.live_gmv).toBe(3_200_000);
    expect(kpi.orders).toBe(40);
    expect(kpi.aov).toBe(100_000);
    expect(kpi.live_share).toBeCloseTo(0.8);
    expect(kpi.video_share).toBeCloseTo(0.2);
  });

  it("CTR/CTOR dirata-rata BERBOBOT GMV, bukan rata-rata polos", () => {
    const kpi = sumPeriodSummaries([
      week({ period_start: "2026-09-01", affiliate_gmv: 9_000_000, ctr: 0.1, ctor: 0.1 }),
      week({ period_start: "2026-09-08", affiliate_gmv: 1_000_000, ctr: 0.2, ctor: 0.2 }),
    ]);
    // Rata-rata polos = 0,15. Berbobot = (0,1*9 + 0,2*1)/10 = 0,11.
    expect(kpi.ctr).toBeCloseTo(0.11);
    expect(kpi.ctor).toBeCloseTo(0.11);
  });

  it("periode kosong → semua nol dan rasio null (tidak membagi nol)", () => {
    const kpi = sumPeriodSummaries([]);
    expect(kpi.gmv).toBe(0);
    expect(kpi.aov).toBeNull();
    expect(kpi.live_share).toBeNull();
    expect(kpi.ctr).toBeNull();
  });

  it("affiliate_gmv null jatuh ke gmv_total", () => {
    expect(sumPeriodSummaries([week({ affiliate_gmv: null, gmv_total: 750_000 })]).gmv).toBe(750_000);
  });
});

const product = (over: Partial<TopProductRowV2> = {}): TopProductRowV2 => ({
  product_id: "P1", product_info: "Serum A", shop_name: "Toko A",
  level1_category: "Beauty", level2_category: "Skincare",
  gmv: 1_000_000, orders: 10, live_gmv: 800_000, video_gmv: 200_000,
  items_sold: 12, live_orders: 8, video_orders: 2, direct_gmv: 0,
  ctr: 0.05, ctor: 0.03, ...over,
});

describe("aggregateProducts", () => {
  it("menggabung produk yang sama lintas minggu", () => {
    const out = aggregateProducts([
      product({ product_id: "P1" }),
      product({ product_id: "P1" }),
      product({ product_id: "P2", product_info: "Toner", gmv: 500_000, orders: 5, live_gmv: 500_000, video_gmv: 0 }),
    ]);
    expect(out).toHaveLength(2);
    const p1 = out.find((p) => p.product_id === "P1")!;
    expect(p1.gmv).toBe(2_000_000);
    expect(p1.live_gmv).toBe(1_600_000);
    expect(p1.items).toBe(24);
    expect(p1.aov).toBe(100_000);
  });

  it("CTR/CTOR produk berbobot GMV; produk tanpa keduanya → null", () => {
    const out = aggregateProducts([
      product({ product_id: "P1", gmv: 9_000_000, ctr: 0.1, ctor: 0.1 }),
      product({ product_id: "P1", gmv: 1_000_000, ctr: 0.2, ctor: 0.2 }),
      product({ product_id: "P3", ctr: null, ctor: null }),
    ]);
    expect(out.find((p) => p.product_id === "P1")!.ctr).toBeCloseTo(0.11);
    expect(out.find((p) => p.product_id === "P3")!.ctr).toBeNull();
  });
});

describe("productSplitAvailable / rankProducts", () => {
  it("batch lama (live/video semua nol) ditandai tidak punya pecahan", () => {
    const lama = aggregateProducts([product({ live_gmv: 0, video_gmv: 0 })]);
    expect(productSplitAvailable(lama)).toBe(false);
    const baru = aggregateProducts([product()]);
    expect(productSplitAvailable(baru)).toBe(true);
  });

  it("peringkat memakai dimensi yang diminta dan membuang yang nol", () => {
    const rows = aggregateProducts([
      product({ product_id: "A", live_gmv: 100, video_gmv: 0, gmv: 100 }),
      product({ product_id: "B", live_gmv: 0, video_gmv: 900, gmv: 900 }),
    ]);
    expect(rankProducts(rows, "live", 10).map((p) => p.product_id)).toEqual(["A"]);
    expect(rankProducts(rows, "video", 10).map((p) => p.product_id)).toEqual(["B"]);
    expect(rankProducts(rows, "total", 10).map((p) => p.product_id)).toEqual(["B", "A"]);
  });

  it("limit dihormati", () => {
    const rows = aggregateProducts([
      product({ product_id: "A", gmv: 3 }), product({ product_id: "B", gmv: 2 }), product({ product_id: "C", gmv: 1 }),
    ]);
    expect(rankProducts(rows, "total", 2)).toHaveLength(2);
  });
});

describe("periodLabel", () => {
  it("mingguan dalam satu bulan", () => {
    expect(periodLabel("weekly", "2026-09-01", "2026-09-08")).toBe("Minggu 1–7 September 2026");
  });
  it("mingguan yang melintasi bulan", () => {
    expect(periodLabel("weekly", "2026-08-31", "2026-09-07")).toBe("Minggu 31 Agustus – 6 September 2026");
  });
  it("bulanan", () => {
    expect(periodLabel("monthly", "2026-09-01", "2026-10-01")).toBe("September 2026");
  });
});

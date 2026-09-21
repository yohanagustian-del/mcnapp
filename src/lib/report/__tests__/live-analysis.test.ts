import { describe, expect, it } from "vitest";
import {
  bestStartHour, bucketByStartHour, rankSessions, sessionTimeline, startHourOf,
  summarizeLiveSessions, toLiveSession, topSessionProducts,
} from "../live-analysis";

const session = (over: Partial<Parameters<typeof toLiveSession>[0]> = {}) =>
  toLiveSession({
    id: 1, session_date: "2026-09-01", session_no: 1, brand: "Brand A",
    start_time: "19:00:00", end_time: "22:00:00", duration_min: 180,
    gmv: 3_000_000, orders: 30, items: 40, views: 1000, viewers_peak: 120,
    impressions_live: 5000, product_impressions: 800, product_clicks: 80,
    ...over,
  });

describe("toLiveSession", () => {
  it("menurunkan rasio dari angka yang tersimpan, bukan menghitung ulang agregat", () => {
    const s = session();
    expect(s.gmv_per_hour).toBe(1_000_000); // 3jt / 3 jam
    expect(s.cvr).toBeCloseTo(0.03); // 30 order / 1000 views
    expect(s.err).toBeCloseTo(0.2); // 1000 views / 5000 impresi
    expect(s.gpm).toBe(3_000_000); // (3jt/1000)*1000
    expect(s.ctr).toBeCloseTo(0.1);
    expect(s.ctor).toBeCloseTo(0.375);
    expect(s.start_hour).toBe(19);
    expect(s.start_time).toBe("19:00");
  });

  it("tidak membagi nol: metrik tanpa penyebut jadi null, bukan 0", () => {
    const s = session({ views: 0, duration_min: 0, product_impressions: 0, product_clicks: 0, impressions_live: null });
    expect(s.cvr).toBeNull();
    expect(s.err).toBeNull();
    expect(s.gpm).toBeNull();
    expect(s.ctr).toBeNull();
    expect(s.ctor).toBeNull();
    expect(s.gmv_per_hour).toBeNull();
    expect(s.impressions_live).toBeNull();
  });

  it("membaca numeric Postgres yang datang sebagai string", () => {
    const s = session({ gmv: "1500000", orders: "15", duration_min: "60" });
    expect(s.gmv).toBe(1_500_000);
    expect(s.gmv_per_hour).toBe(1_500_000);
  });
});

describe("startHourOf", () => {
  it("mengambil jam dari HH:MM(:SS) dan menolak yang bukan jam", () => {
    expect(startHourOf("19:30:00")).toBe(19);
    expect(startHourOf("09:05")).toBe(9);
    expect(startHourOf(null)).toBeNull();
    expect(startHourOf("bukan jam")).toBeNull();
  });
});

describe("bucketByStartHour / bestStartHour", () => {
  const sessions = [
    session({ id: 1, start_time: "19:00:00", duration_min: 120, gmv: 2_000_000 }),
    session({ id: 2, session_date: "2026-09-02", start_time: "19:00:00", duration_min: 120, gmv: 1_000_000 }),
    session({ id: 3, session_date: "2026-09-03", start_time: "13:00:00", duration_min: 60, gmv: 2_000_000 }),
  ];

  it("menggabung sesi per jam mulai", () => {
    const buckets = bucketByStartHour(sessions);
    expect(buckets.map((b) => b.hour)).toEqual([13, 19]);
    expect(buckets.find((b) => b.hour === 19)?.gmv).toBe(3_000_000);
    expect(buckets.find((b) => b.hour === 19)?.gmv_per_hour).toBe(750_000);
  });

  it("jam terbaik dipilih dari GMV per jam, bukan GMV total", () => {
    // Jam 19 total GMV lebih besar, tapi jam 13 menghasilkan 2jt/jam.
    expect(bestStartHour(bucketByStartHour(sessions))).toBe(13);
  });

  it("sesi tanpa jam mulai tidak dimasukkan ke jam 0", () => {
    expect(bucketByStartHour([session({ start_time: null })])).toEqual([]);
    expect(bestStartHour([])).toBeNull();
  });

  it("tanpa GMV positif, jam terbaik tidak punya arti → null", () => {
    expect(bestStartHour(bucketByStartHour([session({ gmv: 0 })]))).toBeNull();
  });
});

describe("rankSessions", () => {
  it("mengurutkan GMV desc dan stabil pada nilai sama", () => {
    const a = session({ id: 1, gmv: 1_000_000 });
    const b = session({ id: 2, session_date: "2026-09-02", gmv: 5_000_000 });
    const c = session({ id: 3, session_date: "2026-08-30", gmv: 1_000_000 });
    expect(rankSessions([a, b, c], 2).map((s) => s.session_id)).toEqual([2, 3]);
  });
});

describe("summarizeLiveSessions", () => {
  it("menjumlah sesi dan menghitung cakupan terhadap GMV live platform", () => {
    const sessions = [
      session({ id: 1, gmv: 3_000_000, duration_min: 180, views: 1000, orders: 30 }),
      session({ id: 2, session_date: "2026-09-02", gmv: 1_000_000, duration_min: 60, views: 500, orders: 10 }),
    ];
    const live = summarizeLiveSessions(sessions, 8_000_000, 5);
    expect(live.available).toBe(true);
    expect(live.sessions).toBe(2);
    expect(live.days).toBe(2);
    expect(live.gmv).toBe(4_000_000);
    expect(live.duration_total_min).toBe(240);
    expect(live.duration_avg_min).toBe(120);
    expect(live.longest_session_min).toBe(180);
    expect(live.gmv_per_session).toBe(2_000_000);
    expect(live.gmv_per_hour).toBe(1_000_000);
    expect(live.cvr).toBeCloseTo(40 / 1500);
    expect(live.coverage_ratio).toBe(0.5);
  });

  it("tanpa sesi: available false dan semua rasio null", () => {
    const live = summarizeLiveSessions([], 0, 5);
    expect(live.available).toBe(false);
    expect(live.gmv).toBe(0);
    expect(live.cvr).toBeNull();
    expect(live.coverage_ratio).toBeNull();
    expect(live.best_start_hour).toBeNull();
  });
});

describe("topSessionProducts", () => {
  it("menggabung produk yang sama lintas baris lalu mengurutkan GMV", () => {
    const rows = [
      { session_id: 1, product_id: "P1", product_name: "Serum", gmv: 1_000_000, items: 10, orders: 8, product_impressions: 100, product_clicks: 20 },
      { session_id: 2, product_id: "P1", product_name: "Serum", gmv: 500_000, items: 5, orders: 4, product_impressions: 100, product_clicks: 20 },
      { session_id: 1, product_id: "P2", product_name: "Toner", gmv: 900_000, items: 9, orders: 9, product_impressions: 50, product_clicks: 10 },
    ];
    const top = topSessionProducts(rows, 2);
    expect(top.map((p) => p.name)).toEqual(["Serum", "Toner"]);
    expect(top[0].gmv).toBe(1_500_000);
    expect(top[0].ctr).toBeCloseTo(0.2);
    expect(top[0].ctor).toBeCloseTo(0.3);
  });
});

describe("sessionTimeline", () => {
  it("meneruskan interval apa adanya, viewers null tetap null", () => {
    expect(sessionTimeline([{ session_id: 1, time: "19:00", gmv: "100", viewers: null }])).toEqual([
      { label: "19:00", gmv: 100, viewers: null },
    ]);
  });
});

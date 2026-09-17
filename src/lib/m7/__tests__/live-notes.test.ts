import { describe, expect, it } from "vitest";
import { buildLiveNotes } from "../live-notes";
import type { ProjectReportLive } from "../report-data";

// Sesi live nyata dari QA produksi 2026-09-17 (export LIVE Center, 5 interval).
const LIVE: ProjectReportLive = {
  sessions: 1, session_no: 1, brands: ["OMG Oh My Glam"],
  first_date: "2026-09-17", last_date: "2026-09-17",
  start_time: "08:54", end_time: "10:54", duration_min: 120,
  gmv: 338_887, orders: 10, items: 11, customers: 10,
  views: 908, viewers_peak: 9, impressions_live: 15_051,
  product_impressions: 2_763, product_clicks: 149, add_to_cart: 7,
  likes: 2_764, comments: 75, shares: 4, new_followers: 1,
  ctr: 149 / 2_763, ctor: 10 / 149, gpm: (338_887 / 908) * 1000,
  gmv_trend: 338_887, gmv_trend_diff: 0,
  products: [{ name: "Mattelast Lip Cream", gmv: 208_857, items: 7, clicks: 84 }],
  products_total: 11, products_sold: 5,
  top_unsold: { name: "Complete Makeup Look Set", impressions: 74 },
  items_per_order: 1.1, cohort_ctr: 0.034, cohort_creators: 2,
  timeline: [
    { label: "08:54", gmv: 0, viewers: 7 },
    { label: "09:24", gmv: 131_821, viewers: 6 },
    { label: "09:54", gmv: 207_066, viewers: 9 },
    { label: "10:24", gmv: 0, viewers: 6 },
    { label: "10:54", gmv: 0, viewers: 2 },
  ],
  notes: [],
};

describe("buildLiveNotes (deterministik, 0 token — CLAUDE.md #1)", () => {
  it("menyebut di interval mana jualannya terjadi, lalu ekor sesi yang kosong", () => {
    const [alur] = buildLiveNotes(LIVE);
    expect(alur).toContain("Seluruh GMV Rp338.887");
    expect(alur).toContain("2 dari 5 interval");
    expect(alur).toContain("09:24 dan 09:54");
    expect(alur).toContain("1 jam terakhir (10:24–10:54) nol transaksi");
    expect(alur).toContain("penonton turun dari 9 ke 2");
  });

  it("memakai kalimat puncak kalau transaksinya tersebar di banyak interval", () => {
    const timeline = LIVE.timeline.map((t, i) => ({ ...t, gmv: i === 2 ? 207_066 : 32_954 }));
    const [alur] = buildLiveNotes({ ...LIVE, timeline });
    expect(alur).toContain("Penjualan terbesar ada di interval 09:54");
    expect(alur).toContain("5 dari 5 interval");
  });

  it("merangkai CTR/CTOR beserta pembanding peserta lain dan produk yang belum laku", () => {
    const efisiensi = buildLiveNotes(LIVE).find((n) => n.startsWith("CTR produk"))!;
    expect(efisiensi).toContain("CTR produk 5,4%");
    expect(efisiensi).toContain("149 klik dari 2.763 impresi produk");
    expect(efisiensi).toContain("CTOR 6,7% ke 10 pesanan");
    expect(efisiensi).toContain("rata-rata seluruh peserta live project ini 3,4%");
    expect(efisiensi).toContain("Nilai per pesanan Rp33.889");
    expect(efisiensi).toContain("1,1 item per pesanan");
    expect(efisiensi).toContain('"Complete Makeup Look Set" (74 impresi)');
  });

  it("tidak menyebut pembanding kohort kalau peserta live-nya cuma dia sendiri", () => {
    const efisiensi = buildLiveNotes({ ...LIVE, cohort_creators: 1 }).find((n) => n.startsWith("CTR produk"))!;
    expect(efisiensi).not.toContain("rata-rata seluruh peserta");
  });

  it("melaporkan interaksi penonton sebagai modal sesi berikutnya", () => {
    const interaksi = buildLiveNotes(LIVE).find((n) => n.includes("likes"))!;
    expect(interaksi).toContain("2.764 likes");
    expect(interaksi).toContain("75 komentar dari 908 views");
    expect(interaksi).toContain("8,3 komentar per 100 views");
    expect(interaksi).toContain("1 follower baru");
  });

  it("tidak mengarang catatan untuk sesi tanpa penjualan sama sekali", () => {
    const kosong = buildLiveNotes({
      ...LIVE, gmv: 0, orders: 0, likes: 0, comments: 0, new_followers: 0,
      product_impressions: 0, product_clicks: 0, add_to_cart: 0, ctr: null, ctor: null,
      products: [], products_total: 0, products_sold: 0, top_unsold: null, items_per_order: null,
      timeline: [{ label: "20:00", gmv: 0, viewers: 3 }],
    });
    expect(kosong).toEqual([]);
  });

  it("melewati catatan ekor sesi kalau interval terakhir justru menjual", () => {
    const notes = buildLiveNotes({
      ...LIVE,
      timeline: [
        { label: "08:54", gmv: 0, viewers: 7 },
        { label: "09:24", gmv: 131_821, viewers: 6 },
        { label: "09:54", gmv: 207_066, viewers: 9 },
      ],
    });
    expect(notes[0]).not.toContain("nol transaksi");
  });
});

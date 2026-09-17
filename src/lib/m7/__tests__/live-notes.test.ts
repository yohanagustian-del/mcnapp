import { describe, expect, it } from "vitest";
import { buildLiveNotes } from "../live-notes";
import type { ProjectReportLive } from "../report-data";

// Sesi live nyata dari QA produksi 2026-09-17 (export LIVE Center, 5 interval).
const LIVE: ProjectReportLive = {
  sessions: 1, brands: ["OMG Oh My Glam"],
  first_date: "2026-09-17", last_date: "2026-09-17",
  start_time: "08:54", end_time: "10:54", duration_min: 120,
  gmv: 338_887, orders: 10, items: 11, customers: 10,
  views: 908, viewers_peak: 9, impressions_live: 15_051,
  product_impressions: 2_763, product_clicks: 149, add_to_cart: 7,
  likes: 2_764, comments: 75, shares: 4, new_followers: 1,
  ctr: 149 / 2_763, ctor: 10 / 149, gpm: (338_887 / 908) * 1000,
  gmv_trend: 338_887, gmv_trend_diff: 0,
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
  it("menyebut interval puncak dan berapa interval yang benar-benar menjual", () => {
    const [peak] = buildLiveNotes(LIVE);
    expect(peak).toContain("09:54");
    expect(peak).toContain("Rp207.066");
    expect(peak).toContain("61,1%"); // 207.066 / 338.887
    expect(peak).toContain("2"); // 2 dari 5 interval menghasilkan transaksi
  });

  it("menandai ekor sesi tanpa transaksi beserta turunnya penonton", () => {
    const tail = buildLiveNotes(LIVE).find((n) => n.includes("ditutup"));
    expect(tail).toBeDefined();
    expect(tail).toContain("2 interval terakhir");
    expect(tail).toContain("10:24");
    expect(tail).toContain("dari puncak 9 ke 2");
  });

  it("merangkai impresi → klik → pesanan apa adanya", () => {
    const funnel = buildLiveNotes(LIVE).find((n) => n.includes("Rantai konversi"));
    expect(funnel).toContain("2.763 impresi produk");
    expect(funnel).toContain("149 klik");
    expect(funnel).toContain("10 pesanan");
    expect(funnel).toContain("CTR 5,4%");
    expect(funnel).toContain("CTOR 6,7%");
  });

  it("melaporkan interaksi penonton", () => {
    const interaksi = buildLiveNotes(LIVE).find((n) => n.startsWith("Interaksi"));
    expect(interaksi).toContain("2.764 likes");
    expect(interaksi).toContain("75 komentar");
    expect(interaksi).toContain("908 views");
    expect(interaksi).toContain("1 follower baru");
  });

  it("tidak mengarang catatan untuk sesi tanpa penjualan sama sekali", () => {
    const kosong = buildLiveNotes({
      ...LIVE, gmv: 0, orders: 0, likes: 0, comments: 0, new_followers: 0,
      product_impressions: 0, product_clicks: 0, add_to_cart: 0, ctr: null, ctor: null,
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
    expect(notes.some((n) => n.includes("ditutup"))).toBe(false);
  });
});

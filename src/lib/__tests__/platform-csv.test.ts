import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveJenisCreator, periodRangeByCreator, platformFromReportSource, rankTopNiches, sumBatchPerCreator,
  resolveCreatorNames, resolveCreatorNamesByPlatform,
} from "../platform-csv";

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

describe("platformFromReportSource", () => {
  it("maps tiktok report sources to tiktok", () => {
    expect(platformFromReportSource("mcn_tiktok_product")).toBe("tiktok");
    expect(platformFromReportSource("tap_tiktok_product")).toBe("tiktok");
    expect(platformFromReportSource("mcn_tiktok_live")).toBe("tiktok");
    expect(platformFromReportSource("tap_tiktok_live")).toBe("tiktok");
  });
  it("maps shopee and sap report sources to shopee", () => {
    expect(platformFromReportSource("shopee")).toBe("shopee");
    expect(platformFromReportSource("sap")).toBe("shopee");
  });
});

describe("deriveJenisCreator", () => {
  it("returns 'live & vt' when both live and video gmv are positive", () => {
    expect(deriveJenisCreator(1_000, 2_000)).toBe("live & vt");
  });
  it("returns 'live' when only live gmv is positive", () => {
    expect(deriveJenisCreator(1_000, 0)).toBe("live");
    expect(deriveJenisCreator(1_000, null)).toBe("live");
  });
  it("returns 'vt' when only video gmv is positive", () => {
    expect(deriveJenisCreator(0, 1_000)).toBe("vt");
    expect(deriveJenisCreator(null, 1_000)).toBe("vt");
  });
  it("returns null when neither is positive (leave existing value unchanged)", () => {
    expect(deriveJenisCreator(0, 0)).toBeNull();
    expect(deriveJenisCreator(null, null)).toBeNull();
    expect(deriveJenisCreator(undefined, undefined)).toBeNull();
  });
});

describe("periodRangeByCreator", () => {
  it("takes min(period_start)/max(period_end) across day buckets per creator", () => {
    const totals = [
      { creatorId: "CRT-1", period: "2026-07-01" },
      { creatorId: "CRT-1", period: "2026-07-03" },
      { creatorId: "CRT-1", period: "2026-07-02" },
      { creatorId: "CRT-2", period: "2026-07-05" },
    ];
    const result = periodRangeByCreator(totals);
    expect(result.get("CRT-1")).toEqual({ start: "2026-07-01", end: "2026-07-03" });
    expect(result.get("CRT-2")).toEqual({ start: "2026-07-05", end: "2026-07-05" });
  });

  it("single bucket → start === end", () => {
    const result = periodRangeByCreator([{ creatorId: "CRT-1", period: "2026-07-01" }]);
    expect(result.get("CRT-1")).toEqual({ start: "2026-07-01", end: "2026-07-01" });
  });
});

describe("rankTopNiches", () => {
  it("aggregates value per (creator, sub_category) and ranks descending", () => {
    const rows = [
      { creator_id: "CRT-1", sub_category: "beauty", value: 100 },
      { creator_id: "CRT-1", sub_category: "beauty", value: 50 }, // second batch, same category
      { creator_id: "CRT-1", sub_category: "fashion", value: 200 },
      { creator_id: "CRT-1", sub_category: "home", value: 10 },
    ];
    const result = rankTopNiches(rows);
    expect(result.get("CRT-1")).toEqual(["fashion", "beauty", "home"]);
  });

  it("caps at top 3 categories", () => {
    const rows = [
      { creator_id: "CRT-1", sub_category: "a", value: 5 },
      { creator_id: "CRT-1", sub_category: "b", value: 4 },
      { creator_id: "CRT-1", sub_category: "c", value: 3 },
      { creator_id: "CRT-1", sub_category: "d", value: 2 },
    ];
    const result = rankTopNiches(rows);
    expect(result.get("CRT-1")).toEqual(["a", "b", "c"]);
  });

  it("keeps creators independent", () => {
    const rows = [
      { creator_id: "CRT-1", sub_category: "beauty", value: 100 },
      { creator_id: "CRT-2", sub_category: "fashion", value: 50 },
    ];
    const result = rankTopNiches(rows);
    expect(result.get("CRT-1")).toEqual(["beauty"]);
    expect(result.get("CRT-2")).toEqual(["fashion"]);
  });

  it("ignores rows with empty sub_category", () => {
    const rows = [
      { creator_id: "CRT-1", sub_category: "", value: 100 },
      { creator_id: "CRT-1", sub_category: "beauty", value: 10 },
    ];
    const result = rankTopNiches(rows);
    expect(result.get("CRT-1")).toEqual(["beauty"]);
  });

  it("returns an empty map for no rows", () => {
    expect(rankTopNiches([]).size).toBe(0);
  });
});

describe("sumBatchPerCreator", () => {
  it("sums a metric across multiple day-buckets for multiple creators", () => {
    const totals = [
      { creatorId: "CRT-ZM5E3", metrics: new Map([["affiliate_gmv", 100_000_000]]) },
      { creatorId: "CRT-ZM5E3", metrics: new Map([["affiliate_gmv", 335_700_000]]) },
      { creatorId: "CRT-ZM5E3", metrics: new Map([["affiliate_gmv", 237_900]]) },
      { creatorId: "CRT-PBFTB", metrics: new Map([["affiliate_gmv", 7_450_000]]) },
      { creatorId: "CRT-2YC8J", metrics: new Map([["affiliate_gmv", 10_200_000]]) },
    ];
    const result = sumBatchPerCreator(totals);
    expect(result.get("CRT-ZM5E3")?.get("affiliate_gmv")).toBe(435_937_900);
    expect(result.get("CRT-PBFTB")?.get("affiliate_gmv")).toBe(7_450_000);
    expect(result.get("CRT-2YC8J")?.get("affiliate_gmv")).toBe(10_200_000);
  });

  it("sums independently per metric within the same creator", () => {
    const totals = [
      {
        creatorId: "CRT-1",
        metrics: new Map([
          ["affiliate_gmv", 1_000],
          ["affiliate_live_gmv", 400],
        ]),
      },
      {
        creatorId: "CRT-1",
        metrics: new Map([
          ["affiliate_gmv", 2_000],
          ["affiliate_video_gmv", 600],
        ]),
      },
    ];
    const result = sumBatchPerCreator(totals);
    expect(result.get("CRT-1")?.get("affiliate_gmv")).toBe(3_000);
    expect(result.get("CRT-1")?.get("affiliate_live_gmv")).toBe(400);
    expect(result.get("CRT-1")?.get("affiliate_video_gmv")).toBe(600);
  });

  it("leaves a metric absent when no bucket has it (does not default to 0)", () => {
    const totals = [
      { creatorId: "CRT-1", metrics: new Map([["affiliate_gmv", 500]]) },
    ];
    const result = sumBatchPerCreator(totals);
    expect(result.get("CRT-1")?.has("affiliate_gmv")).toBe(true);
    expect(result.get("CRT-1")?.has("affiliate_live_gmv")).toBe(false);
    expect(result.get("CRT-1")?.get("affiliate_live_gmv")).toBeUndefined();
  });

  it("handles a single creator with a single bucket", () => {
    const totals = [
      { creatorId: "CRT-1", metrics: new Map([["affiliate_gmv", 999]]) },
    ];
    const result = sumBatchPerCreator(totals);
    expect(result.size).toBe(1);
    expect(result.get("CRT-1")?.get("affiliate_gmv")).toBe(999);
  });

  it("returns an empty map when given no buckets", () => {
    expect(sumBatchPerCreator([]).size).toBe(0);
  });
});

describe("resolveCreatorNames* (gerbang master kreator, migration 0028)", () => {
  /**
   * Mock admin client: `creators` dibaca BERPAGINASI (`.order().range()`, lihat
   * registry.ts) — mock ini meniru batas keras PostgREST 1.000 baris per response
   * supaya regresi "tarik semua dengan .limit(5000)" ketahuan: kalau kode kembali
   * memakai .limit(), pemanggilan .range() tidak ada dan tes gagal.
   */
  function mockAdmin(
    seedCreators: { id: string; name: string; username: string; platform: string | null }[]
  ) {
    const inserted: Record<string, unknown>[] = [];
    const rangesRequested: [number, number][] = [];
    const admin = {
      from: (table: string) => {
        if (table !== "creators") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            order: () => ({
              range: (from: number, to: number) => {
                rangesRequested.push([from, to]);
                // Halaman maksimal 1.000 baris — sama seperti db-max-rows Supabase.
                const pageSize = Math.min(to - from + 1, 1000);
                return Promise.resolve({
                  data: seedCreators.slice(from, from + pageSize),
                  error: null,
                });
              },
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
    return { admin, inserted, rangesRequested };
  }

  it("TIDAK membuat kreator baru — username asing kembali sebagai unresolved", async () => {
    const { admin, inserted } = mockAdmin([]);
    const { byName, unresolved } = await resolveCreatorNames(admin, ["kreator_baru"]);
    expect(byName.size).toBe(0);
    expect(unresolved).toEqual(["kreator_baru"]);
    // Inilah inti perbaikan 2026-07-30: jalur upload tidak boleh INSERT kreator.
    expect(inserted).toHaveLength(0);
  });

  it("mencocokkan username & display name, case-insensitive", async () => {
    const { admin } = mockAdmin([
      { id: "CRT-A", name: "Vika Here", username: "vikahere", platform: "tiktok" },
    ]);
    const { byName, unresolved } = await resolveCreatorNames(admin, ["VikaHere", "vika here"]);
    expect(byName.get("vikahere")).toBe("CRT-A");
    expect(byName.get("vika here")).toBe("CRT-A");
    expect(unresolved).toEqual([]);
  });

  it("menemukan kreator DI LUAR 1.000 baris pertama (bug duplikat 2026-07-30)", async () => {
    // 1.500 kreator: yang ke-1.200 hanya terlihat kalau lookup berpaginasi.
    const seed = Array.from({ length: 1500 }, (_, i) => ({
      id: `CRT-${String(i).padStart(5, "0")}`,
      name: `creator ${i}`,
      username: `creator${i}`,
      platform: "tiktok" as string | null,
    }));
    const { admin, inserted, rangesRequested } = mockAdmin(seed);
    const { byName, unresolved } = await resolveCreatorNames(admin, ["creator1200"]);
    expect(byName.get("creator1200")).toBe("CRT-01200");
    expect(unresolved).toEqual([]);
    expect(inserted).toHaveLength(0);
    // Halaman ke-2 memang diminta (bukan satu request .limit besar).
    expect(rangesRequested.length).toBeGreaterThan(1);
  });

  it("resolveCreatorNamesByPlatform mencocokkan HANYA di platform yang diminta", async () => {
    const { admin, inserted } = mockAdmin([
      { id: "CRT-TIKTOK-1", name: "vikahere", username: "vikahere", platform: "tiktok" },
    ]);
    // Username yang sama ada di TikTok — resolusi Shopee tidak boleh mencocokkannya,
    // dan (sejak 0028) juga tidak membuat kreator Shopee baru.
    const { byName, unresolved } = await resolveCreatorNamesByPlatform(admin, ["vikahere"], "shopee");
    expect(byName.size).toBe(0);
    expect(unresolved).toEqual(["vikahere"]);
    expect(inserted).toHaveLength(0);
  });

  it("resolveCreatorNamesByPlatform mencocokkan kreator shopee existing (case-insensitive)", async () => {
    const { admin } = mockAdmin([
      { id: "CRT-SHOPEE-1", name: "Ayu Efendy", username: "ayuefendy06", platform: "shopee" },
    ]);
    const { byName, unresolved } = await resolveCreatorNamesByPlatform(
      admin, ["AyuEfendy06"], "shopee"
    );
    expect(byName.get("ayuefendy06")).toBe("CRT-SHOPEE-1");
    expect(unresolved).toEqual([]);
  });

  it("daftar nama kosong: tidak query, hasil kosong", async () => {
    const { admin, rangesRequested } = mockAdmin([]);
    const { byName, unresolved } = await resolveCreatorNamesByPlatform(admin, [], "shopee");
    expect(byName.size).toBe(0);
    expect(unresolved).toEqual([]);
    expect(rangesRequested).toHaveLength(0);
  });
});

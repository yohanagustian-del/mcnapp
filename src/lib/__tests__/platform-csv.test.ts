import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveJenisCreator, periodRangeByCreator, platformFromReportSource, rankTopNiches, sumBatchPerCreator,
  resolveCreatorNamesByPlatform,
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

describe("resolveCreatorNamesByPlatform (Shopee ingest, CLAUDE.md #5)", () => {
  /**
   * Mock admin client: creators table pre-seeded, .eq("platform", ...) actually
   * filters, and .range(from, to) paginates like PostgREST — a single page never
   * returns more than PAGE_SIZE (1000) rows, which is what the real API enforces
   * regardless of the requested .limit().
   */
  function mockAdmin(
    seedCreators: { id: string; name: string; username: string; platform: string }[],
    opts: { insertError?: { code: string; message: string } } = {}
  ) {
    const inserted: Record<string, unknown>[] = [];
    const PAGE = 1000;
    const build = (rows: typeof seedCreators) => ({
      eq: (column: string, value: unknown) =>
        build(rows.filter((c) => (c as unknown as Record<string, unknown>)[column] === value)),
      range: (from: number, to: number) =>
        Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + PAGE)), error: null }),
    });
    const admin = {
      from: (table: string) => {
        if (table !== "creators") throw new Error(`unexpected table ${table}`);
        return {
          select: () => build(seedCreators),
          insert: (row: Record<string, unknown>) => {
            if (opts.insertError) return Promise.resolve({ error: opts.insertError });
            inserted.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
    return { admin, inserted };
  }

  it("matches an existing creator ONLY within the given platform", async () => {
    const { admin } = mockAdmin([
      { id: "CRT-TIKTOK-1", name: "vikahere", username: "vikahere", platform: "tiktok" },
    ]);
    // Same username exists on TikTok — Shopee resolution must NOT match it, must create a NEW shopee creator.
    const { byName, createdProspects } = await resolveCreatorNamesByPlatform(
      admin, ["vikahere"], "actor-1", "shopee", "prospek"
    );
    expect(byName.get("vikahere")).not.toBe("CRT-TIKTOK-1");
    expect(createdProspects).toEqual(["vikahere"]);
  });

  it("matches an existing shopee creator by username, case-insensitively", async () => {
    const { admin } = mockAdmin([
      { id: "CRT-SHOPEE-1", name: "Ayu Efendy", username: "ayuefendy06", platform: "shopee" },
    ]);
    const { byName, createdProspects } = await resolveCreatorNamesByPlatform(
      admin, ["AyuEfendy06"], "actor-1", "shopee", "prospek"
    );
    expect(byName.get("ayuefendy06")).toBe("CRT-SHOPEE-1");
    expect(createdProspects).toEqual([]);
  });

  it("creates a new creator with platform=shopee and the given status for unknown usernames", async () => {
    const { admin, inserted } = mockAdmin([]);
    const { createdProspects } = await resolveCreatorNamesByPlatform(
      admin, ["newuser"], "actor-1", "shopee", "prospek"
    );
    expect(createdProspects).toEqual(["newuser"]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ name: "newuser", username: "newuser", status: "prospek", platform: "shopee" });
  });

  it("returns empty maps for an empty name list without querying", async () => {
    const { admin } = mockAdmin([]);
    const { byName, createdProspects } = await resolveCreatorNamesByPlatform(admin, [], "actor-1", "shopee");
    expect(byName.size).toBe(0);
    expect(createdProspects).toEqual([]);
  });

  // Regression: PostgREST caps one select at 1000 rows and silently ignores a
  // larger .limit(). With a bare .limit(5000) every creator past row 1000 was
  // invisible here, so an EXISTING creator was treated as new, re-INSERTed, and
  // the whole weekly upload died on creators_username_platform_uidx.
  it("finds a creator past the 1000-row page instead of trying to create it", async () => {
    const seed = Array.from({ length: 1148 }, (_, i) => ({
      id: `CRT-${i}`, name: `creator ${i}`, username: `user${i}`, platform: "shopee",
    }));
    seed[1088] = { id: "CRT-2S3EF", name: "Upin Ipin", username: "toko_makmur58", platform: "shopee" };
    const { admin, inserted } = mockAdmin(seed);

    const { byName, createdProspects, failed } = await resolveCreatorNamesByPlatform(
      admin, ["toko_makmur58"], "actor-1", "shopee", "aktif"
    );

    expect(byName.get("toko_makmur58")).toBe("CRT-2S3EF");
    expect(createdProspects).toEqual([]);
    expect(failed).toEqual([]);
    expect(inserted).toHaveLength(0);
  });

  it("creates unknown creators with NO CM so a manager assigns them later", async () => {
    const { admin, inserted } = mockAdmin([]);
    await resolveCreatorNamesByPlatform(admin, ["newuser"], "actor-1", "shopee", "aktif");
    expect(inserted[0]).toMatchObject({ owner_cpm_id: null, status: "aktif" });
  });

  // A creator that cannot be created must not abort the whole weekly upload:
  // it is reported in `failed` so the caller skips only that creator's rows.
  it("reports an un-creatable creator in `failed` instead of throwing", async () => {
    const { admin } = mockAdmin([], {
      insertError: { code: "23502", message: 'null value in column "name"' },
    });
    const { byName, createdProspects, failed } = await resolveCreatorNamesByPlatform(
      admin, ["broken"], "actor-1", "shopee", "aktif"
    );
    expect(byName.size).toBe(0);
    expect(createdProspects).toEqual([]);
    expect(failed).toEqual([{ name: "broken", reason: 'null value in column "name"' }]);
  });

  // Concurrent upload created the username between our lookup and our INSERT:
  // reuse the row that now exists instead of failing on the unique index.
  it("reuses the existing creator when the INSERT hits the unique index (23505)", async () => {
    const seed: { id: string; name: string; username: string; platform: string }[] = [];
    const PAGE = 1000;
    const build = (rows: typeof seed) => ({
      eq: (column: string, value: unknown) =>
        build(rows.filter((c) => (c as unknown as Record<string, unknown>)[column] === value)),
      range: (from: number, to: number) =>
        Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + PAGE)), error: null }),
    });
    const admin = {
      from: () => ({
        // Snapshot at call time, so the refresh after 23505 sees the raced row.
        select: () => build([...seed]),
        insert: () => {
          // A parallel upload wins the race and writes the row we were about to insert.
          seed.push({ id: "CRT-RACE", name: "racer", username: "racer", platform: "shopee" });
          return Promise.resolve({
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          });
        },
      }),
    } as unknown as SupabaseClient;

    const { byName, createdProspects, failed } = await resolveCreatorNamesByPlatform(
      admin, ["racer"], "actor-1", "shopee", "aktif"
    );
    expect(byName.get("racer")).toBe("CRT-RACE");
    expect(createdProspects).toEqual([]);
    expect(failed).toEqual([]);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BdShopRow, LeakArtifactCreator } from "../leak-artifact";
import {
  computeLeakRollups,
  writeBdLeadsFromArtifact,
  writeLeakRollups,
  writeLeakWeekSummary,
  writeUnknownLeakRollups,
} from "../leak-rollup";

// Mock getConfig so the rollup uses fixed thresholds (mirrors the engine's app_config
// source: m4.bocor_sebagian / m4.bocor_total). Same pattern as m10/products.test.ts.
vi.mock("@/lib/config", () => ({
  getConfig: vi.fn(async (key: string) => {
    if (key === "m4.bocor_sebagian") return 0.1;
    if (key === "m4.bocor_total") return 0.5;
    throw new Error(`unexpected config key ${key}`);
  }),
}));

function creator(overrides: Partial<LeakArtifactCreator> = {}): LeakArtifactCreator & { creatorId: string } {
  return {
    creatorName: "alpha",
    creatorId: "CRT-1",
    gmvAffiliateTotal: 1_000_000,
    gmvTap: 900_000,
    gmvBocor: 100_000,
    bdOpportunityGmv: 0,
    directGmv: 0,
    effectiveness: 0.9,
    ...overrides,
  } as LeakArtifactCreator & { creatorId: string };
}

describe("computeLeakRollups (reuses M4 rollupCreatorStatus + app_config thresholds)", () => {
  beforeEach(() => vi.clearAllMocks());
  const admin = {} as SupabaseClient;

  it("gmv_deal_total = gmv_tap + gmv_bocor; status via engine formula", async () => {
    // bocor 100k / deal 1M = 0.1 ratio = exactly sebagian threshold → via_agency.
    const res = await computeLeakRollups(admin, [creator({ gmvTap: 900_000, gmvBocor: 100_000 })]);
    expect(res[0].gmvDealTotal).toBe(1_000_000);
    expect(res[0].leakRatio).toBeCloseTo(0.1, 5);
    expect(res[0].linkStatus).toBe("via_agency");
  });

  it("high leak ratio → bocor_total", async () => {
    const res = await computeLeakRollups(admin, [creator({ gmvTap: 100_000, gmvBocor: 900_000 })]);
    expect(res[0].leakRatio).toBeCloseTo(0.9, 5);
    expect(res[0].linkStatus).toBe("bocor_total");
  });

  it("no deal GMV → belum_ada_link, ratio null", async () => {
    const res = await computeLeakRollups(admin, [creator({ gmvTap: 0, gmvBocor: 0 })]);
    expect(res[0].linkStatus).toBe("belum_ada_link");
    expect(res[0].leakRatio).toBeNull();
  });

  it("null bullets treated as 0 for arithmetic; raw nulls preserved", async () => {
    const res = await computeLeakRollups(admin, [creator({ gmvTap: null, gmvBocor: null })]);
    expect(res[0].gmvDealTotal).toBe(0);
    expect(res[0].gmvTap).toBeNull();
    expect(res[0].linkStatus).toBe("belum_ada_link");
  });
});

interface CaptureCLS {
  deletedFilters: Array<{ week: string; ids: string[] }>;
  inserted: unknown[];
}

/** Mock supabase for writeLeakRollups: records the scoped delete + inserts. */
function mockClsClient(capture: CaptureCLS): SupabaseClient {
  return {
    from: () => ({
      delete: () => ({
        eq: (_c: string, week: string) => ({
          in: (_col: string, ids: string[]) => {
            capture.deletedFilters.push({ week, ids });
            return Promise.resolve({ error: null });
          },
        }),
      }),
      insert: (rows: unknown[]) => {
        if (Array.isArray(rows)) capture.inserted.push(...rows);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
}

describe("writeLeakRollups (scoped delete-then-insert)", () => {
  it("deletes only this file's creators for the week, then inserts source='artifact'", async () => {
    const capture: CaptureCLS = { deletedFilters: [], inserted: [] };
    await writeLeakRollups(mockClsClient(capture), "2026-06-01", [
      { creatorId: "CRT-1", creatorName: "a", gmvAffiliateTotal: 1_000_000, gmvTap: 900_000, gmvBocor: 100_000, bdOpportunityGmv: 0, directGmv: 0, effectiveness: 0.9, gmvDealTotal: 1_000_000, leakRatio: 0.1, linkStatus: "via_agency" },
    ]);
    expect(capture.deletedFilters).toEqual([{ week: "2026-06-01", ids: ["CRT-1"] }]);
    const row = capture.inserted[0] as Record<string, unknown>;
    expect(row.source).toBe("artifact");
    expect(row.creator_id).toBe("CRT-1");
    expect(row.gmv_deal_total).toBe(1_000_000);
    expect(row.link_status).toBe("via_agency");
    expect(row.gmv_tap).toBe(900_000);
  });
});

describe("writeUnknownLeakRollups (format v2: link_status/gmv_bocor/leak_ratio left null)", () => {
  it("writes gmv_affiliate_total only; status/bocor/ratio/deal_total are null (unknown, not zero)", async () => {
    const capture: CaptureCLS = { deletedFilters: [], inserted: [] };
    await writeUnknownLeakRollups(mockClsClient(capture), "2026-06-01", [
      { creatorId: "CRT-9", creatorName: "bidanlilis77", gmvAffiliateTotal: 121_193_930, gmvTap: null, gmvBocor: null, bdOpportunityGmv: null, directGmv: null, effectiveness: null },
    ]);
    expect(capture.deletedFilters).toEqual([{ week: "2026-06-01", ids: ["CRT-9"] }]);
    const row = capture.inserted[0] as Record<string, unknown>;
    expect(row.source).toBe("artifact");
    expect(row.creator_id).toBe("CRT-9");
    expect(row.gmv_affiliate_total).toBe(121_193_930);
    expect(row.gmv_deal_total).toBeNull();
    expect(row.gmv_bocor).toBeNull();
    expect(row.leak_ratio).toBeNull();
    expect(row.link_status).toBeNull();
    expect(row.gmv_tap).toBeNull();
  });

  it("empty creator list is a no-op", async () => {
    const capture: CaptureCLS = { deletedFilters: [], inserted: [] };
    await writeUnknownLeakRollups(mockClsClient(capture), "2026-06-01", []);
    expect(capture.deletedFilters).toHaveLength(0);
    expect(capture.inserted).toHaveLength(0);
  });
});

interface CaptureLws {
  deletedFilters: Array<{ week: string; uploadedBy: string | null; isNull: boolean }>;
  inserted: unknown[];
}

/** Mock supabase for writeLeakWeekSummary: records the delete-then-insert. */
function mockLwsClient(capture: CaptureLws): SupabaseClient {
  return {
    from: () => ({
      delete: () => ({
        eq: (_c: string, week: string) => ({
          eq: (_c2: string, uploadedBy: string) => {
            capture.deletedFilters.push({ week, uploadedBy, isNull: false });
            return Promise.resolve({ error: null });
          },
          is: (_c2: string, _v: null) => {
            capture.deletedFilters.push({ week, uploadedBy: null, isNull: true });
            return Promise.resolve({ error: null });
          },
        }),
      }),
      insert: (row: unknown) => {
        capture.inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
}

describe("writeLeakWeekSummary (CM-level totals, delete-then-insert on week+uploaded_by)", () => {
  it("v2: writes source_format='artifact_v2'", async () => {
    const capture: CaptureLws = { deletedFilters: [], inserted: [] };
    await writeLeakWeekSummary(
      mockLwsClient(capture),
      "2026-06-01",
      "2026-06-07",
      { gmvAffiliateTotal: 347_379_967, gmvTap: 66_090_474, gmvLeakPotential: 185_764_946 },
      "v2",
      "actor-1"
    );
    expect(capture.deletedFilters).toEqual([{ week: "2026-06-01", uploadedBy: "actor-1", isNull: false }]);
    const row = capture.inserted[0] as Record<string, unknown>;
    expect(row.source_format).toBe("artifact_v2");
    expect(row.week).toBe("2026-06-01");
    expect(row.period_end).toBe("2026-06-07");
    expect(row.gmv_affiliate_total).toBe(347_379_967);
    expect(row.gmv_tap).toBe(66_090_474);
    expect(row.gmv_leak_potential).toBe(185_764_946);
    expect(row.uploaded_by).toBe("actor-1");
  });

  it("v1: writes source_format='artifact_v1'", async () => {
    const capture: CaptureLws = { deletedFilters: [], inserted: [] };
    await writeLeakWeekSummary(
      mockLwsClient(capture),
      "2026-06-01",
      "2026-06-07",
      { gmvAffiliateTotal: 1, gmvTap: 2, gmvLeakPotential: 3 },
      "v1",
      "actor-1"
    );
    expect((capture.inserted[0] as Record<string, unknown>).source_format).toBe("artifact_v1");
  });

  it("null uploader uses .is() (not .eq()) so the delete actually matches NULL rows", async () => {
    const capture: CaptureLws = { deletedFilters: [], inserted: [] };
    await writeLeakWeekSummary(
      mockLwsClient(capture),
      "2026-06-01",
      "2026-06-07",
      { gmvAffiliateTotal: null, gmvTap: null, gmvLeakPotential: null },
      "v2",
      null
    );
    expect(capture.deletedFilters).toEqual([{ week: "2026-06-01", uploadedBy: null, isNull: true }]);
    expect((capture.inserted[0] as Record<string, unknown>).uploaded_by).toBeNull();
  });
});

interface CaptureBd {
  selectedChunks: string[][];
  inserted: unknown[];
  upserted: unknown[];
}

/** Mock supabase for writeBdLeadsFromArtifact with a preset of existing shop ids. */
function mockBdClient(existing: string[], capture: CaptureBd): SupabaseClient {
  const set = new Set(existing);
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, chunk: string[]) => {
          capture.selectedChunks.push(chunk);
          const data = chunk.filter((id) => set.has(id)).map((id) => ({ shop_id: id }));
          return Promise.resolve({ data, error: null });
        },
      }),
      insert: (rows: unknown[]) => {
        if (Array.isArray(rows)) capture.inserted.push(...rows);
        return Promise.resolve({ error: null });
      },
      upsert: (rows: unknown[]) => {
        if (Array.isArray(rows)) capture.upserted.push(...rows);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
}

function bdShop(overrides: Partial<BdShopRow> = {}): BdShopRow {
  return {
    shopId: "7496144953400855459",
    shopName: "ALV",
    level1Category: "Womenswear",
    level2Category: "Bottoms",
    gmvOpportunity: 105_983_915,
    numCreators: 1,
    totalProductsPromoted: 3,
    ...overrides,
  };
}

describe("writeBdLeadsFromArtifact (engine semantics: new=full, existing=metrics only)", () => {
  it("new shop inserted with source='artifact', first_seen_week, frequency=Num Creators", async () => {
    const capture: CaptureBd = { selectedChunks: [], inserted: [], upserted: [] };
    const res = await writeBdLeadsFromArtifact(mockBdClient([], capture), "2026-06-01", [bdShop()]);
    expect(res).toEqual({ created: 1, updated: 0 });
    const row = capture.inserted[0] as Record<string, unknown>;
    expect(row.source).toBe("artifact");
    expect(row.first_seen_week).toBe("2026-06-01");
    expect(row.frequency).toBe(1);
    expect(row.total_gmv).toBe(105_983_915);
    expect(row.priority_score).toBe(105_983_915);
  });

  it("existing shop updated via metrics-only upsert (no source/status/first_seen in payload)", async () => {
    const capture: CaptureBd = { selectedChunks: [], inserted: [], upserted: [] };
    const res = await writeBdLeadsFromArtifact(
      mockBdClient(["7496144953400855459"], capture), "2026-06-01", [bdShop({ numCreators: 3 })]);
    expect(res).toEqual({ created: 0, updated: 1 });
    const row = capture.upserted[0] as Record<string, unknown>;
    expect(row.frequency).toBe(3);
    expect(row.source).toBeUndefined();
    expect(row.status).toBeUndefined();
    expect(row.first_seen_week).toBeUndefined();
  });

  it("empty shop list is a no-op", async () => {
    const capture: CaptureBd = { selectedChunks: [], inserted: [], upserted: [] };
    const res = await writeBdLeadsFromArtifact(mockBdClient([], capture), "2026-06-01", []);
    expect(res).toEqual({ created: 0, updated: 0 });
    expect(capture.selectedChunks).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PX-M3-A coverage-push tests. Mirrors capability-recompute.test.ts's
 * mocking style (mock @/lib/audit, a fake admin client) plus a stubbed
 * global fetch for the outbound bridge call.
 */

let auditCalls: Record<string, unknown>[] = [];
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async (entry: Record<string, unknown>) => {
    auditCalls.push(entry);
  }),
}));

let coverageRows: Array<{
  level2_category: string;
  price_segment: string;
  creator_count: number;
  total_slots_available: number;
  total_proven_gmv: number;
  status: string;
}> = [];
vi.mock("../capability-data", () => ({
  listCoverage: vi.fn(async () => coverageRows),
}));

import { pushCoverageForBatch, pushCoverageSnapshot } from "../coverage-push";

function fakeAdmin(): SupabaseClient {
  return {} as unknown as SupabaseClient;
}

const ENV_KEYS = ["CDPS_BRIDGE_URL", "BRIDGE_PX_SECRET"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  auditCalls = [];
  coverageRows = [];
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.CDPS_BRIDGE_URL = "https://cdps.example.com";
  process.env.BRIDGE_PX_SECRET = "test-secret";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe("pushCoverageSnapshot", () => {
  it("skips (no fetch) when CDPS_BRIDGE_URL is missing", async () => {
    delete process.env.CDPS_BRIDGE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await pushCoverageSnapshot(fakeAdmin());
    expect(result).toMatchObject({ skipped: expect.stringMatching(/CDPS_BRIDGE_URL/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips (no fetch) when BRIDGE_PX_SECRET is missing", async () => {
    delete process.env.BRIDGE_PX_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await pushCoverageSnapshot(fakeAdmin());
    expect(result).toMatchObject({ skipped: expect.stringMatching(/BRIDGE_PX_SECRET/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips (no fetch) when there are zero coverage rows", async () => {
    coverageRows = [];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await pushCoverageSnapshot(fakeAdmin());
    expect(result).toMatchObject({ skipped: expect.stringMatching(/nol baris/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws (does not silently truncate) when rows exceed the 5.000-row contract cap", async () => {
    coverageRows = Array.from({ length: 5001 }, (_, i) => ({
      level2_category: `Kategori ${i}`,
      price_segment: "mid",
      creator_count: 1,
      total_slots_available: 1,
      total_proven_gmv: 0,
      status: "covered",
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(pushCoverageSnapshot(fakeAdmin())).rejects.toThrow(/5000|5\.000/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts exactly the 6-column row shape + snapshot_at/source/policy_note, nothing else — nol creator_id (K-2)", async () => {
    coverageRows = [
      {
        level2_category: "Sepatu Wanita",
        price_segment: "mid",
        creator_count: 7,
        total_slots_available: 19,
        total_proven_gmv: 1284000000,
        status: "covered",
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ batch_key: "px-coverage-20260101-abc123def456", rows_received: 1, duplicate: false }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushCoverageSnapshot(fakeAdmin());
    expect(result).toEqual({ batchKey: "px-coverage-20260101-abc123def456", rowsReceived: 1, duplicate: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cdps.example.com/api/v1/internal/bridge/px-coverage");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer test-secret");
    expect(headers["Idempotency-Key"]).toMatch(/^px-coverage-\d{8}-[0-9a-f]{12}$/);

    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(["policy_note", "rows", "snapshot_at", "source"]);
    expect(body.source).toBe("mcnapp");
    expect(typeof body.snapshot_at).toBe("string");
    expect(body.rows).toHaveLength(1);
    expect(Object.keys(body.rows[0]).sort()).toEqual([
      "creator_count",
      "level2_category",
      "price_segment",
      "status",
      "total_proven_gmv",
      "total_slots_available",
    ]);
    expect(body.rows[0]).toEqual({
      level2_category: "Sepatu Wanita",
      price_segment: "mid",
      creator_count: 7,
      total_slots_available: 19,
      total_proven_gmv: 1284000000,
      status: "covered",
    });
    // K-2, explicit: no creator identity anywhere in the wire body.
    expect(JSON.stringify(body)).not.toMatch(/creator_id|creator_ids|creatorId/i);
  });

  it("coerces numeric-looking string fields (Postgres numeric/bigint via PostgREST) to real JSON numbers", async () => {
    coverageRows = [
      {
        level2_category: "Tas Wanita",
        price_segment: "mid",
        // Cast through `unknown` to simulate a driver returning numeric/bigint as string.
        creator_count: "3" as unknown as number,
        total_slots_available: "5" as unknown as number,
        total_proven_gmv: "640000000.00" as unknown as number,
        status: "covered",
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ batch_key: "k", rows_received: 1, duplicate: false }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await pushCoverageSnapshot(fakeAdmin());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.rows[0].creator_count).toBe(3);
    expect(body.rows[0].total_slots_available).toBe(5);
    expect(body.rows[0].total_proven_gmv).toBe(640000000);
    expect(typeof body.rows[0].creator_count).toBe("number");
  });

  it("throws with the response body on a non-2xx from CDPS", async () => {
    coverageRows = [
      { level2_category: "X", price_segment: "low", creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status: "covered" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => "[payload coverage tidak sesuai kontrak: kolom 'x' tidak dikenal]",
      }))
    );
    await expect(pushCoverageSnapshot(fakeAdmin())).rejects.toThrow(/422/);
  });

  it("surfaces duplicate:true on an idempotent replay without treating it as an error", async () => {
    coverageRows = [
      { level2_category: "X", price_segment: "low", creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status: "covered" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ batch_key: "px-coverage-20260101-abc123def456", rows_received: 0, duplicate: true }),
      }))
    );
    const result = await pushCoverageSnapshot(fakeAdmin());
    expect(result).toEqual({ batchKey: "px-coverage-20260101-abc123def456", rowsReceived: 0, duplicate: true });
  });
});

describe("pushCoverageForBatch (ingest step contract)", () => {
  it("reports skipped (no audit) when a precondition isn't met", async () => {
    coverageRows = [];
    const result = await pushCoverageForBatch(fakeAdmin(), "actor-1");
    expect(result.skipped).toMatch(/nol baris/);
    expect(result.result).toBeNull();
    expect(result.error).toBeNull();
    expect(auditCalls).toHaveLength(0);
  });

  it("writes px_coverage_pushed on success", async () => {
    coverageRows = [
      { level2_category: "X", price_segment: "low", creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status: "covered" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ batch_key: "k1", rows_received: 1, duplicate: false }),
      }))
    );
    const result = await pushCoverageForBatch(fakeAdmin(), "actor-1");
    expect(result.result).toEqual({ batchKey: "k1", rowsReceived: 1, duplicate: false });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ actorId: "actor-1", action: "px_coverage_pushed", type: "auto" });
  });

  it("NEVER throws on failure — reports error and logs px_coverage_push_failed", async () => {
    coverageRows = [
      { level2_category: "X", price_segment: "low", creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status: "covered" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const result = await pushCoverageForBatch(fakeAdmin(), "actor-1");
    expect(result.result).toBeNull();
    expect(result.error).toContain("network down");
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ actorId: "actor-1", action: "px_coverage_push_failed", type: "auto" });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeSharedAutoFillFields, fetchMonthlyAvgGmvByCreator, writeCreatorAutoFillUpdate,
} from "../creator-autofill";

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

describe("computeSharedAutoFillFields (shared by TikTok run.ts and Shopee shopee-run.ts)", () => {
  const avgGmv = { gmv: 1_000_000, gmvLive: 600_000, gmvVideo: 400_000, monthsCounted: 1 };

  it("sets status to aktif when creator existed with a different status", () => {
    const existing = { id: "CRT-1", status: "prospek", platform: "shopee", jenis_creator: null };
    const { updates, before, after } = computeSharedAutoFillFields(existing, "shopee", "live", avgGmv);
    expect(updates.status).toBe("aktif");
    expect(before.status).toBe("prospek");
    expect(after.status).toBe("aktif");
  });

  it("does not touch status when already aktif", () => {
    const existing = { id: "CRT-1", status: "aktif", platform: "shopee", jenis_creator: null };
    const { updates } = computeSharedAutoFillFields(existing, "shopee", "live", avgGmv);
    expect(updates.status).toBeUndefined();
  });

  it("always writes gmv/gmv_live/gmv_video from the averages passed in", () => {
    const { updates, after } = computeSharedAutoFillFields(undefined, "shopee", null, avgGmv);
    expect(updates.gmv).toBe(1_000_000);
    expect(updates.gmv_live).toBe(600_000);
    expect(updates.gmv_video).toBe(400_000);
    expect(after.gmv).toBe(1_000_000);
  });

  it("sets platform when missing or different from the target platform", () => {
    const existingTiktok = { id: "CRT-1", status: "aktif", platform: "tiktok", jenis_creator: null };
    const { updates, before, after } = computeSharedAutoFillFields(existingTiktok, "shopee", null, avgGmv);
    expect(updates.platform).toBe("shopee");
    expect(before.platform).toBe("tiktok");
    expect(after.platform).toBe("shopee");
  });

  it("sets jenis_creator only when it changed", () => {
    const existing = { id: "CRT-1", status: "aktif", platform: "shopee", jenis_creator: "live" };
    const unchanged = computeSharedAutoFillFields(existing, "shopee", "live", avgGmv);
    expect(unchanged.updates.jenis_creator).toBeUndefined();

    const changed = computeSharedAutoFillFields(existing, "shopee", "live & vt", avgGmv);
    expect(changed.updates.jenis_creator).toBe("live & vt");
  });

  it("does not set jenis_creator when derivation returns null (leaves existing value untouched)", () => {
    const existing = { id: "CRT-1", status: "aktif", platform: "shopee", jenis_creator: "live" };
    const { updates } = computeSharedAutoFillFields(existing, "shopee", null, avgGmv);
    expect(updates.jenis_creator).toBeUndefined();
  });
});

describe("fetchMonthlyAvgGmvByCreator", () => {
  function mockAdmin(rows: Record<string, unknown>[]): SupabaseClient {
    return {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it("returns an average entry per requested creator id, even with zero history", async () => {
    const admin = mockAdmin([]);
    const result = await fetchMonthlyAvgGmvByCreator(admin, ["CRT-1"]);
    expect(result.get("CRT-1")).toEqual({ gmv: 0, gmvLive: 0, gmvVideo: 0, monthsCounted: 0 });
  });

  it("averages monthly totals from creator_period_summary rows", async () => {
    const admin = mockAdmin([
      {
        creator_id: "CRT-1", period_start: "2026-07-01", gmv_total: 300_000,
        affiliate_live_gmv: 200_000, affiliate_video_gmv: 100_000, created_at: "2026-07-08T00:00:00Z",
      },
    ]);
    const result = await fetchMonthlyAvgGmvByCreator(admin, ["CRT-1"]);
    expect(result.get("CRT-1")?.gmv).toBe(300_000);
    expect(result.get("CRT-1")?.monthsCounted).toBe(1);
  });

  it("returns an empty map without querying when creatorIds is empty", async () => {
    const admin = mockAdmin([]);
    const result = await fetchMonthlyAvgGmvByCreator(admin, []);
    expect(result.size).toBe(0);
  });
});

describe("writeCreatorAutoFillUpdate", () => {
  it("updates the creators row and writes an audit entry", async () => {
    const updateCalls: Record<string, unknown>[] = [];
    const admin = {
      from: () => ({
        update: (updates: Record<string, unknown>) => ({
          eq: () => {
            updateCalls.push(updates);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    } as unknown as SupabaseClient;

    await writeCreatorAutoFillUpdate(admin, "actor-1", "CRT-1", { gmv: 100 }, {}, { gmv: 100 });
    expect(updateCalls).toEqual([{ gmv: 100 }]);
  });
});

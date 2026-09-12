import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PX-M1 recompute tests:
 *  - calls px_capability_recompute scoped to THIS batch's creators + the shared
 *    window cutoff (windowStart/loadProjectionConfig reused, not re-derived);
 *  - a failed recompute is reported (not thrown) and writes
 *    `px_capability_recompute_failed` to audit_logs — old proven_* values are
 *    left alone by construction (the SQL function's own transaction rolls back,
 *    this test only asserts the TS-level contract: no throw, error surfaced,
 *    audit written).
 */

let auditCalls: Record<string, unknown>[] = [];
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async (entry: Record<string, unknown>) => {
    auditCalls.push(entry);
  }),
}));
vi.mock("@/lib/projection/project-gmv", () => ({
  loadProjectionConfig: vi.fn(async () => ({ windowDays: 28 })),
  windowStart: vi.fn((days: number) => `cutoff-${days}d`),
}));

import { recomputeCapability, recomputeCapabilityForBatch } from "../capability-recompute";

function mockAdmin(rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>): SupabaseClient {
  return { rpc: rpcImpl } as unknown as SupabaseClient;
}

beforeEach(() => {
  auditCalls = [];
});

describe("recomputeCapability", () => {
  it("returns 0 rows without calling rpc when there are no creators in the batch", async () => {
    const rpc = vi.fn();
    const result = await recomputeCapability(mockAdmin(rpc), []);
    expect(result).toEqual({ rowsAffected: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls px_capability_recompute scoped to the batch creators + shared window cutoff", async () => {
    const rpc = vi.fn(async () => ({ data: 7, error: null }));
    const result = await recomputeCapability(mockAdmin(rpc), ["CRT-1", "CRT-2"]);
    expect(rpc).toHaveBeenCalledWith("px_capability_recompute", {
      p_creator_ids: ["CRT-1", "CRT-2"],
      p_cutoff: "cutoff-28d",
    });
    expect(result).toEqual({ rowsAffected: 7 });
  });

  it("throws when the RPC reports an error (caller decides rollback semantics)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    await expect(recomputeCapability(mockAdmin(rpc), ["CRT-1"])).rejects.toThrow("boom");
  });
});

describe("recomputeCapabilityForBatch (ingest step contract)", () => {
  it("skips (no rpc call, no audit) when the batch has no creators", async () => {
    const rpc = vi.fn();
    const result = await recomputeCapabilityForBatch(mockAdmin(rpc), [], "actor-1");
    expect(result.skipped).toMatch(/tidak ada kreator/i);
    expect(result.rows).toBeNull();
    expect(result.error).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(auditCalls).toHaveLength(0);
  });

  it("returns rows on success, without writing a failure audit row", async () => {
    const rpc = vi.fn(async () => ({ data: 3, error: null }));
    const result = await recomputeCapabilityForBatch(mockAdmin(rpc), ["CRT-1"], "actor-1");
    expect(result).toEqual({ rows: 3, skipped: null, error: null });
    expect(auditCalls).toHaveLength(0);
  });

  it("NEVER throws on failure — reports capabilityError and logs px_capability_recompute_failed (old values untouched)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "db exploded" } }));
    const result = await recomputeCapabilityForBatch(mockAdmin(rpc), ["CRT-1"], "actor-1");
    expect(result.rows).toBeNull();
    expect(result.error).toContain("db exploded");
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      actorId: "actor-1",
      action: "px_capability_recompute_failed",
      type: "auto",
    });
  });
});

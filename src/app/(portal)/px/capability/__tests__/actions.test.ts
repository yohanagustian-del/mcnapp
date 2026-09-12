import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PX-M1 K4 gate tests (surat tugas §2/Langkah 5 — the rule PRD §3.2 Rule 4 does
 * NOT have): a role list alone is not enough for px.capability.write. `cpm` may
 * only touch rows of creators.owner_cpm_id = self; `cm_lead`/management touch
 * every row. Out-of-scope rows must be REJECTED with a Bahasa Indonesia message,
 * never silently dropped. Mock pattern mirrors
 * link-leakage/__tests__/upload-cooperating-shops.test.ts.
 */

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let auditCalls: Record<string, unknown>[] = [];

const CREATORS = [
  { id: "CRT-A1", owner_cpm_id: "cpm-A" },
  { id: "CRT-B1", owner_cpm_id: "cpm-B" },
];

const CAPABILITY_ROWS = [
  {
    creator_id: "CRT-A1", creator_name: "Kreator A1", creator_username: "a1", creator_status: "aktif",
    owner_cpm_id: "cpm-A", level2_category: "Skincare", price_segment: "sweet",
    proven_gmv: 1_000_000, proven_orders: 10, last_computed_at: "2026-09-01T00:00:00Z",
    slots_total: 2, slots_committed: 0, slots_available: 2, updated_at: "2026-09-01T00:00:00Z",
  },
  {
    creator_id: "CRT-B1", creator_name: "Kreator B1", creator_username: "b1", creator_status: "aktif",
    owner_cpm_id: "cpm-B", level2_category: "Fashion", price_segment: "entry",
    proven_gmv: 500_000, proven_orders: 5, last_computed_at: "2026-09-01T00:00:00Z",
    slots_total: 1, slots_committed: 1, slots_available: 0, updated_at: "2026-09-01T00:00:00Z",
  },
];

function mockAdmin(): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "creators") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({ data: CREATORS.filter((c) => ids.includes(c.id)), error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "px_capability_list") {
        const ids = args.p_creator_ids as string[] | null;
        const rows = ids ? CAPABILITY_ROWS.filter((r) => ids.includes(r.creator_id)) : CAPABILITY_ROWS;
        return Promise.resolve({ data: rows, error: null });
      }
      if (fn === "px_capability_bulk_set_slots") {
        rpcCalls.push({ fn, args });
        const updates = args.p_updates as unknown[];
        return Promise.resolve({ data: updates.length, error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  } as unknown as SupabaseClient;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async (entry: Record<string, unknown>) => {
    auditCalls.push(entry);
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mockAdmin() }));

const requirePermissionMock = vi.fn();
vi.mock("@/lib/rbac", () => ({ requirePermission: (...args: unknown[]) => requirePermissionMock(...args) }));

import { bulkSetCapabilitySlots } from "../actions";

function updatesField(updates: Record<string, unknown>[]): FormData {
  const fd = new FormData();
  fd.set("updates", JSON.stringify(updates));
  return fd;
}

beforeEach(() => {
  rpcCalls.length = 0;
  auditCalls = [];
  requirePermissionMock.mockReset();
});

describe("bulkSetCapabilitySlots — gerbang per-baris CPM (K4)", () => {
  it("cpm A cannot change the slots of a creator owned by cpm B", async () => {
    requirePermissionMock.mockResolvedValue({ id: "cpm-A", role: "cpm" });
    const fd = updatesField([
      { creatorId: "CRT-B1", level2Category: "Fashion", priceSegment: "entry", slotsTotal: 3 },
    ]);
    const result = await bulkSetCapabilitySlots(null, fd);
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain("Akses ditolak");
    expect(result?.message).toContain("CRT-B1");
    expect(rpcCalls).toHaveLength(0); // never reaches the write RPC
  });

  it("cpm A CAN change the slots of its own creator", async () => {
    requirePermissionMock.mockResolvedValue({ id: "cpm-A", role: "cpm" });
    const fd = updatesField([
      { creatorId: "CRT-A1", level2Category: "Skincare", priceSegment: "sweet", slotsTotal: 5 },
    ]);
    const result = await bulkSetCapabilitySlots(null, fd);
    expect(result?.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_updates).toEqual([
      { creator_id: "CRT-A1", level2_category: "Skincare", price_segment: "sweet", slots_total: 5 },
    ]);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("px_slots_updated");
  });

  it("cm_lead can change rows across different CPMs' creators (no per-row gate)", async () => {
    requirePermissionMock.mockResolvedValue({ id: "lead-1", role: "cm_lead" });
    const fd = updatesField([
      { creatorId: "CRT-A1", level2Category: "Skincare", priceSegment: "sweet", slotsTotal: 4 },
      { creatorId: "CRT-B1", level2Category: "Fashion", priceSegment: "entry", slotsTotal: 2 },
    ]);
    const result = await bulkSetCapabilitySlots(null, fd);
    expect(result?.ok).toBe(true);
    expect((rpcCalls[0].args.p_updates as unknown[])).toHaveLength(2);
  });

  it("rejects slots_total below the current slots_committed, naming the current number", async () => {
    requirePermissionMock.mockResolvedValue({ id: "lead-1", role: "cm_lead" });
    // CRT-B1/Fashion/entry has slots_committed = 1 (fixture above).
    const fd = updatesField([
      { creatorId: "CRT-B1", level2Category: "Fashion", priceSegment: "entry", slotsTotal: 0 },
    ]);
    const result = await bulkSetCapabilitySlots(null, fd);
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain("1"); // current slots_committed named in the message
    expect(rpcCalls).toHaveLength(0);
  });
});

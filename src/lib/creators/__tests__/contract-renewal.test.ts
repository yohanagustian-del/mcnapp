import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

let auditCalls: Record<string, unknown>[] = [];
let creatorUpdates: Record<string, unknown>[] = [];
let periodInserts: Record<string, unknown>[] = [];

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async (entry: Record<string, unknown>) => {
    auditCalls.push(entry);
  }),
}));

function mockAdmin(opts: {
  creator: { id: string; name: string; status: string; contract_end_date: string | null } | null;
  latestPeriodEnd: string | null;
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "creators") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.creator, error: null }) }),
          }),
          update: (payload: Record<string, unknown>) => {
            creatorUpdates.push(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === "creator_contract_periods") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: opts.latestPeriodEnd ? { end_date: opts.latestPeriodEnd } : null,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            periodInserts.push(payload);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 42 }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

import { renewCreatorContract } from "../contract-renewal";

beforeEach(() => {
  auditCalls = [];
  creatorUpdates = [];
  periodInserts = [];
});

describe("renewCreatorContract (PLAN_MSDPS Paket D, Q7/Q8)", () => {
  it("menolak end_date <= start_date", async () => {
    const admin = mockAdmin({ creator: { id: "CRT-1", name: "A", status: "aktif", contract_end_date: "2026-01-01" }, latestPeriodEnd: null });
    const result = await renewCreatorContract(admin, {
      creatorId: "CRT-1", startDate: "2026-10-01", endDate: "2026-09-01", actorId: "m1",
    });
    expect(result.ok).toBe(false);
    expect(periodInserts).toHaveLength(0);
  });

  it("menolak kreator tidak ditemukan", async () => {
    const admin = mockAdmin({ creator: null, latestPeriodEnd: null });
    const result = await renewCreatorContract(admin, {
      creatorId: "CRT-X", startDate: "2026-10-01", endDate: "2026-12-01", actorId: "m1",
    });
    expect(result.ok).toBe(false);
  });

  it("Q8: menolak overlap (start_date <= akhir periode sebelumnya)", async () => {
    const admin = mockAdmin({
      creator: { id: "CRT-1", name: "A", status: "aktif", contract_end_date: "2026-09-01" },
      latestPeriodEnd: "2026-09-01",
    });
    const result = await renewCreatorContract(admin, {
      creatorId: "CRT-1", startDate: "2026-09-01", endDate: "2026-12-01", actorId: "m1",
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("tumpang tindih");
    expect(periodInserts).toHaveLength(0);
  });

  it("Q8: menerima jeda antar periode (start_date jauh setelah akhir periode lama)", async () => {
    const admin = mockAdmin({
      creator: { id: "CRT-1", name: "A", status: "aktif", contract_end_date: "2026-06-01" },
      latestPeriodEnd: "2026-06-01",
    });
    const result = await renewCreatorContract(admin, {
      creatorId: "CRT-1", startDate: "2026-09-01", endDate: "2026-12-01", actorId: "m1", notes: "comeback",
    });
    expect(result.ok).toBe(true);
    expect(periodInserts[0]).toMatchObject({ start_date: "2026-09-01", end_date: "2026-12-01", notes: "comeback" });
  });

  it("Q7: kreator nonaktif otomatis kembali aktif kalau status tidak dipaksa", async () => {
    const admin = mockAdmin({
      creator: { id: "CRT-1", name: "A", status: "nonaktif", contract_end_date: "2026-01-01" },
      latestPeriodEnd: null,
    });
    const result = await renewCreatorContract(admin, {
      creatorId: "CRT-1", startDate: "2026-02-01", endDate: "2026-12-01", actorId: "m1",
    });
    expect(result.ok).toBe(true);
    expect(creatorUpdates[0]).toMatchObject({ contract_end_date: "2026-12-01", status: "aktif" });
  });

  it("status eksplisit (registerCreator memaksa 'binding') mengabaikan aturan nonaktif->aktif", async () => {
    const admin = mockAdmin({
      creator: { id: "CRT-1", name: "A", status: "nonaktif", contract_end_date: "2026-01-01" },
      latestPeriodEnd: null,
    });
    const result = await renewCreatorContract(admin, {
      creatorId: "CRT-1", startDate: "2026-02-01", endDate: "2026-12-01", actorId: "m1", status: "binding",
    });
    expect(result.ok).toBe(true);
    expect(creatorUpdates[0]).toMatchObject({ status: "binding" });
  });

  it("kreator aktif tetap aktif (bukan diturunkan)", async () => {
    const admin = mockAdmin({
      creator: { id: "CRT-1", name: "A", status: "aktif", contract_end_date: "2026-01-01" },
      latestPeriodEnd: null,
    });
    await renewCreatorContract(admin, { creatorId: "CRT-1", startDate: "2026-02-01", endDate: "2026-12-01", actorId: "m1" });
    expect(creatorUpdates[0]).toMatchObject({ status: "aktif" });
  });

  it("menulis audit m8.creator_contract_renew dengan before/after", async () => {
    const admin = mockAdmin({
      creator: { id: "CRT-1", name: "A", status: "aktif", contract_end_date: "2026-01-01" },
      latestPeriodEnd: null,
    });
    await renewCreatorContract(admin, { creatorId: "CRT-1", startDate: "2026-02-01", endDate: "2026-12-01", actorId: "m1" });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("m8.creator_contract_renew");
    expect(auditCalls[0].type).toBe("auto");
    expect((auditCalls[0].before as Record<string, unknown>).contract_end_date).toBe("2026-01-01");
    expect((auditCalls[0].after as Record<string, unknown>).contract_end_date).toBe("2026-12-01");
  });

  it("menolak format tanggal yang bukan YYYY-MM-DD", async () => {
    const admin = mockAdmin({ creator: { id: "CRT-1", name: "A", status: "aktif", contract_end_date: null }, latestPeriodEnd: null });
    const result = await renewCreatorContract(admin, {
      creatorId: "CRT-1", startDate: "1 Feb 2026", endDate: "2026-12-01", actorId: "m1",
    });
    expect(result.ok).toBe(false);
  });
});

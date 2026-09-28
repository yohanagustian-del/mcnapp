import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PLAN_MSDPS_mcnapp.md Paket A (A-05): verifySlotAction's 3 modes — no test existed
 * for schedule/actions.ts before this. Mock pattern mirrors
 * px/capability/__tests__/actions.test.ts (mockAdmin + vi.mock rbac/audit/admin).
 */

let auditCalls: Record<string, unknown>[] = [];
let updatePayloads: Record<string, unknown>[] = [];

const CREATOR = { id: "CRT-1", live_roster: true, owner_cpm_id: "cpm-1" };

function makeSlot(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    creator_id: "CRT-1",
    schedule_date: "2026-09-20",
    start_time: "19:00:00",
    end_time: "21:00:00",
    status: "scheduled",
    fokus_produk: "Serum rencana",
    pk_ready: false,
    product_connected_tap: false,
    actual_start: null,
    actual_end: null,
    actual_time_source: null,
    fokus_produk_live: null,
    ...overrides,
  };
}

function mockAdmin(slot: Record<string, unknown>): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "creators") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: CREATOR, error: null }) }) }) };
      }
      if (table === "live_schedule_slots") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: slot, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { ...slot, ...payload }, error: null }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async (entry: Record<string, unknown>) => {
    auditCalls.push(entry);
  }),
}));

let currentAdmin: SupabaseClient;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => currentAdmin }));

const requirePermissionMock = vi.fn();
vi.mock("@/lib/rbac", () => ({ requirePermission: (...args: unknown[]) => requirePermissionMock(...args) }));

// "Today" pinned to 2026-09-20 (WIB) so schedule_date="2026-09-20" always verifies.
vi.mock("@/lib/utils/date", () => ({ todayWib: () => "2026-09-20" }));

// m13.auto_verify_correction_days default 7 (PLAN_MSDPS Paket B) — tests below
// pass their own verified_at relative to "now" (mocked via vi.setSystemTime).
vi.mock("@/lib/config", () => ({ getConfig: async () => 7 }));

import { verifySlotAction, cancelVerifiedSlotAction } from "../actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  auditCalls = [];
  updatePayloads = [];
  requirePermissionMock.mockReset();
  requirePermissionMock.mockResolvedValue({ id: "cm-1", role: "cm_lead" });
});

describe("verifySlotAction — mode sesuai_rencana (PLAN_MSDPS R1)", () => {
  it("menyalin jam rencana dari SERVER (bukan dari klien) dan set actual_time_source", async () => {
    currentAdmin = mockAdmin(makeSlot());
    const result = await verifySlotAction(fd({ slot_id: "1", mode: "sesuai_rencana" }));
    expect(result.ok).toBe(true);
    expect(updatePayloads[0]).toMatchObject({
      actual_start: "19:00:00",
      actual_end: "21:00:00",
      actual_time_source: "sesuai_rencana",
      status: "done",
    });
  });

  it("mengabaikan actual_start/actual_end kiriman klien meski disertakan (server tidak pernah percaya klien untuk mode ini)", async () => {
    currentAdmin = mockAdmin(makeSlot());
    await verifySlotAction(fd({ slot_id: "1", mode: "sesuai_rencana", actual_start: "23:59", actual_end: "23:59" }));
    expect(updatePayloads[0].actual_start).toBe("19:00:00");
    expect(updatePayloads[0].actual_end).toBe("21:00:00");
  });

  it("ditolak dengan pesan jelas bila slot tidak punya jam rencana", async () => {
    currentAdmin = mockAdmin(makeSlot({ start_time: null, end_time: null }));
    const result = await verifySlotAction(fd({ slot_id: "1", mode: "sesuai_rencana" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("belum punya jam rencana");
    expect(updatePayloads).toHaveLength(0);
  });

  it("menyimpan fokus_produk_live opsional dan membawanya ke audit", async () => {
    currentAdmin = mockAdmin(makeSlot());
    await verifySlotAction(fd({ slot_id: "1", mode: "sesuai_rencana", fokus_produk_live: "Serum realisasi" }));
    expect(updatePayloads[0].fokus_produk_live).toBe("Serum realisasi");
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("schedule.verify_slot");
    expect((auditCalls[0].after as Record<string, unknown>).actual_time_source).toBe("sesuai_rencana");
  });
});

describe("verifySlotAction — mode jam_baru (perilaku lama)", () => {
  it("memakai jam dari klien dan actual_time_source=input_manual", async () => {
    currentAdmin = mockAdmin(makeSlot());
    const result = await verifySlotAction(
      fd({ slot_id: "1", mode: "jam_baru", actual_start: "19:10", actual_end: "21:05" })
    );
    expect(result.ok).toBe(true);
    expect(updatePayloads[0]).toMatchObject({
      actual_start: "19:10",
      actual_end: "21:05",
      actual_time_source: "input_manual",
    });
  });

  it("ditolak bila jam kosong", async () => {
    currentAdmin = mockAdmin(makeSlot());
    const result = await verifySlotAction(fd({ slot_id: "1", mode: "jam_baru" }));
    expect(result.ok).toBe(false);
    expect(updatePayloads).toHaveLength(0);
  });

  it("ditolak bila jam mulai >= jam selesai", async () => {
    currentAdmin = mockAdmin(makeSlot());
    const result = await verifySlotAction(
      fd({ slot_id: "1", mode: "jam_baru", actual_start: "21:00", actual_end: "19:00" })
    );
    expect(result.ok).toBe(false);
  });
});

describe("verifySlotAction — guard umum", () => {
  it("ditolak untuk slot yang sudah done", async () => {
    currentAdmin = mockAdmin(makeSlot({ status: "done" }));
    const result = await verifySlotAction(fd({ slot_id: "1", mode: "sesuai_rencana" }));
    expect(result.ok).toBe(false);
  });

  it("ditolak untuk slot masa depan", async () => {
    currentAdmin = mockAdmin(makeSlot({ schedule_date: "2026-09-21" }));
    const result = await verifySlotAction(fd({ slot_id: "1", mode: "sesuai_rencana" }));
    expect(result.ok).toBe(false);
  });
});

describe("verifySlotAction / cancelVerifiedSlotAction — koreksi slot auto_sistem (PLAN_MSDPS Paket B, Q5)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("CM boleh mengoreksi slot auto_sistem ke jam baru dalam jendela koreksi", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z")); // 5 hari setelah auto-verify
    currentAdmin = mockAdmin(makeSlot({
      status: "done", actual_time_source: "auto_sistem",
      actual_start: null, actual_end: null, verified_at: "2026-09-15T00:00:00.000Z",
    }));
    const result = await verifySlotAction(
      fd({ slot_id: "1", mode: "jam_baru", actual_start: "19:10", actual_end: "21:05" })
    );
    expect(result.ok).toBe(true);
    expect(updatePayloads[0]).toMatchObject({ actual_time_source: "input_manual", actual_start: "19:10" });
  });

  it("ditolak setelah jendela koreksi (7 hari) lewat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:00:00.000Z")); // 10 hari setelah auto-verify
    currentAdmin = mockAdmin(makeSlot({
      status: "done", actual_time_source: "auto_sistem", verified_at: "2026-09-15T00:00:00.000Z",
    }));
    const result = await verifySlotAction(
      fd({ slot_id: "1", mode: "jam_baru", actual_start: "19:10", actual_end: "21:05" })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Masa koreksi");
    expect(updatePayloads).toHaveLength(0);
  });

  it("CM boleh menandai slot auto_sistem 'Tidak Jadi Live' dalam jendela koreksi", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z"));
    currentAdmin = mockAdmin(makeSlot({
      status: "done", actual_time_source: "auto_sistem", verified_at: "2026-09-15T00:00:00.000Z",
    }));
    const result = await cancelVerifiedSlotAction(fd({ slot_id: "1", cancel_reason: "Ternyata batal, baru ketahuan sekarang" }));
    expect(result.ok).toBe(true);
    expect(updatePayloads[0]).toMatchObject({ status: "cancelled" });
  });

  it("slot verifikasi MANUAL (bukan auto_sistem) tetap terkunci selamanya, tidak ada jendela koreksi", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T00:00:00.000Z")); // 1 hari saja setelah verifikasi manual
    currentAdmin = mockAdmin(makeSlot({
      status: "done", actual_time_source: "input_manual", verified_at: "2026-09-15T00:00:00.000Z",
    }));
    const result = await verifySlotAction(fd({ slot_id: "1", mode: "sesuai_rencana" }));
    expect(result.ok).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPendingCreators } from "../pending";

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

interface SeedRow {
  id: number;
  username: string;
  platform: string | null;
  status: string;
  seen_count: number;
}

/**
 * Mock admin client untuk tabel creator_pending_registrations:
 * `.select().in()` mengembalikan seed, `.insert()`/`.update()` dicatat.
 */
function mockAdmin(seed: SeedRow[]) {
  const inserted: Record<string, unknown>[] = [];
  const updated: { id: number; payload: Record<string, unknown> }[] = [];
  const admin = {
    from: (table: string) => {
      if (table !== "creator_pending_registrations") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          in: (_col: string, values: string[]) =>
            Promise.resolve({
              data: seed.filter((r) =>
                values.some((v) => v.toLowerCase() === r.username.toLowerCase())
              ),
              error: null,
            }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, id: number) => {
            updated.push({ id, payload });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { admin, inserted, updated };
}

describe("recordPendingCreators (daftar tunggu kreator, migration 0028)", () => {
  it("mencatat username baru sebagai pending dengan snapshot dari file", async () => {
    const { admin, inserted } = mockAdmin([]);
    const result = await recordPendingCreators(admin, {
      usernames: ["kreator_baru"],
      source: "mcn_weekly",
      platform: "tiktok",
      batchId: "ingest:2026-07-01:abc12345",
      actorId: "actor-1",
      rowsByUsername: new Map([["kreator_baru", 42]]),
      followersByUsername: new Map([["kreator_baru", 138988]]),
    });

    expect(result.created).toEqual(["kreator_baru"]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      username: "kreator_baru",
      platform: "tiktok",
      source: "mcn_weekly",
      status: "pending",
      seen_count: 1,
      rows_affected: 42,
      followers: 138988,
      first_batch_id: "ingest:2026-07-01:abc12345",
    });
  });

  it("deteksi ulang menaikkan seen_count, tidak menambah baris (anti-duplikat)", async () => {
    const { admin, inserted, updated } = mockAdmin([
      { id: 7, username: "kreator_lama", platform: "tiktok", status: "pending", seen_count: 3 },
    ]);
    const result = await recordPendingCreators(admin, {
      usernames: ["Kreator_Lama"], // casing berbeda — tetap baris yang sama
      source: "mcn_weekly",
      platform: "tiktok",
    });

    expect(result.bumped).toEqual(["Kreator_Lama"]);
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(7);
    expect(updated[0].payload).toMatchObject({ seen_count: 4 });
  });

  it("baris yang sudah ditolak tetap ditolak (tidak diangkat jadi pending lagi)", async () => {
    const { admin, updated } = mockAdmin([
      { id: 9, username: "salah_tulis", platform: "tiktok", status: "rejected", seen_count: 1 },
    ]);
    const result = await recordPendingCreators(admin, {
      usernames: ["salah_tulis"],
      source: "mcn_weekly",
      platform: "tiktok",
    });

    expect(result.rejected).toEqual(["salah_tulis"]);
    expect(result.bumped).toEqual([]);
    // Counter tetap naik, status TIDAK diubah kembali ke pending.
    expect(updated[0].payload).toMatchObject({ seen_count: 2 });
    expect(updated[0].payload.status).toBeUndefined();
  });

  it("platform NULL dianggap tiktok — tidak membuat baris kembar", async () => {
    const { admin, inserted, updated } = mockAdmin([
      { id: 11, username: "handle", platform: null, status: "pending", seen_count: 1 },
    ]);
    await recordPendingCreators(admin, {
      usernames: ["handle"],
      source: "mcn_weekly",
      platform: "tiktok",
    });
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(1);
  });

  it("daftar kosong: tidak menulis apa pun", async () => {
    const { admin, inserted, updated } = mockAdmin([]);
    const result = await recordPendingCreators(admin, { usernames: [], source: "mcn_weekly" });
    expect(result).toEqual({ created: [], bumped: [], rejected: [] });
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });
});

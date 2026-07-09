import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeShopeeAggregates } from "../shopee-run";
import type { ShopeePeriodSummaryRow } from "../shopee-aggregate";

// ─── Recording mock Supabase (same pattern as run.test.ts) ───
interface Op {
  table: string;
  op: "delete" | "insert";
  filters?: { column: string; value: unknown }[];
  rows?: unknown[];
}

function mockSupabase(ops: Op[]): SupabaseClient {
  return {
    from: (table: string) => ({
      delete: () => {
        const entry: Op = { table, op: "delete", filters: [] };
        ops.push(entry);
        const chain = {
          in: (column: string, value: unknown) => {
            entry.filters!.push({ column, value });
            return chain;
          },
          eq: (column: string, value: unknown) => {
            entry.filters!.push({ column, value });
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      },
      insert: (rows: unknown[]) => {
        ops.push({ table, op: "insert", rows });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
}

const BATCH = "ingest-shopee:2026-07-01:abcd1234";
const PERIOD_START = "2026-07-01";
const CREATOR_IDS = ["CRT-001"];

const summary: ShopeePeriodSummaryRow[] = [
  {
    creatorId: "CRT-001", periodStart: "2026-07-01", periodEnd: "2026-07-07",
    gmvTotal: 300_000, affiliateLiveGmv: 200_000, affiliateVideoGmv: 100_000, orders: 5,
  },
];

describe("writeShopeeAggregates (creator_period_summary ONLY, idempotent per creator x week)", () => {
  it("deletes scoped to creator_id + period_start from creator_period_summary BEFORE insert", async () => {
    const ops: Op[] = [];
    await writeShopeeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, summary);

    const deletes = ops.filter((o) => o.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("creator_period_summary");
    expect(deletes[0].filters).toEqual([
      { column: "creator_id", value: CREATOR_IDS },
      { column: "period_start", value: PERIOD_START },
    ]);
    const lastDelete = ops.map((o) => o.op).lastIndexOf("delete");
    const firstInsert = ops.map((o) => o.op).indexOf("insert");
    expect(lastDelete).toBeLessThan(firstInsert);
  });

  it("does NOT touch creator_subcat_segment_gmv or creator_top_products (Shopee has no subcat/top-products yet)", async () => {
    const ops: Op[] = [];
    await writeShopeeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, summary);
    const tables = new Set(ops.map((o) => o.table));
    expect(tables.has("creator_subcat_segment_gmv")).toBe(false);
    expect(tables.has("creator_top_products")).toBe(false);
  });

  it("maps aggregate fields to snake_case columns; affiliate_gmv mirrors gmv_total", async () => {
    const ops: Op[] = [];
    await writeShopeeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, summary);
    const insert = ops.find((o) => o.op === "insert")!;
    expect(insert.rows?.[0]).toMatchObject({
      creator_id: "CRT-001", upload_batch: BATCH, gmv_total: 300_000, affiliate_gmv: 300_000,
      affiliate_live_gmv: 200_000, affiliate_video_gmv: 100_000, orders: 5, live_pct: 200_000 / 300_000,
    });
  });

  it("leaves TikTok-only columns (items_sold, ctr, ctor, direct_gmv, refund_gmv, live/video orders) at neutral defaults, not fabricated", async () => {
    const ops: Op[] = [];
    await writeShopeeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, summary);
    const insert = ops.find((o) => o.op === "insert")!;
    expect(insert.rows?.[0]).toMatchObject({
      items_sold: 0, ctr: null, ctor: null, direct_gmv: 0, refund_gmv: 0, live_orders: 0, video_orders: 0, nmv: null,
    });
  });

  it("skips delete entirely when creatorIds is empty", async () => {
    const ops: Op[] = [];
    await writeShopeeAggregates(mockSupabase(ops), BATCH, [], PERIOD_START, []);
    expect(ops.filter((o) => o.op === "delete")).toHaveLength(0);
  });

  it("regression: re-uploading the identical file (same batch_id) replaces via delete-then-insert, no duplication", async () => {
    const ops: Op[] = [];
    await writeShopeeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, summary);
    await writeShopeeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, summary);
    const inserts = ops.filter((o) => o.op === "insert");
    expect(inserts).toHaveLength(2);
    for (const ins of inserts) expect(ins.rows).toHaveLength(1);
  });

  it("regression: two CMs uploading different creator sets for the SAME week don't clobber each other", async () => {
    const opsA: Op[] = [];
    await writeShopeeAggregates(
      mockSupabase(opsA), "ingest-shopee:2026-07-01:hashA", ["CRT-A"], PERIOD_START,
      [{ ...summary[0], creatorId: "CRT-A" }]
    );
    const opsB: Op[] = [];
    await writeShopeeAggregates(
      mockSupabase(opsB), "ingest-shopee:2026-07-01:hashB", ["CRT-B"], PERIOD_START,
      [{ ...summary[0], creatorId: "CRT-B" }]
    );
    const deleteB = opsB.find((o) => o.op === "delete")!;
    const creatorFilter = deleteB.filters!.find((f) => f.column === "creator_id");
    expect(creatorFilter?.value).toEqual(["CRT-B"]);
    expect(creatorFilter?.value).not.toContain("CRT-A");
  });
});

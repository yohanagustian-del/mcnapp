import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAggregates } from "../run";
import type { PeriodSummaryRow, SubcatSegmentRow, TopProductRow } from "../aggregate";

// ─── Recording mock Supabase (pola src/lib/m3/__tests__/adapters.test.ts) ───
// Tiap .from(table) mengembalikan builder chainable; delete mendukung .in()
// lalu .eq() (dua filter, sesuai delete scope creator×periode baru), insert
// dicatat urut, semua resolve ke { error: null }.
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

const BATCH = "ingest:2026-06-28:abcd1234";
const PERIOD_START = "2026-06-28";
const PERIOD_END = "2026-07-04";
const CREATOR_IDS = ["CRT-001"];

const summary: PeriodSummaryRow[] = [
  {
    creatorId: "CRT-001", periodStart: "2026-06-28", periodEnd: "2026-07-04",
    gmvTotal: 1_000_000, affiliateGmv: 1_000_000, affiliateLiveGmv: 600_000,
    affiliateVideoGmv: 400_000, liveOrders: 5, videoOrders: 3, orders: 8,
    itemsSold: 10, directGmv: 900_000, refundGmv: 0, ctr: 10, ctor: 2, livePct: 0.6,
  },
];
const subcat: SubcatSegmentRow[] = [
  {
    creatorId: "CRT-001", level2Category: "Drinks", priceSegment: "low",
    windowEnd: "2026-07-04", gmv: 1_000_000, liveGmv: 600_000, itemsSold: 10,
    orders: 8, avgPrice: 100_000,
  },
];
const top: TopProductRow[] = [
  {
    creatorId: "CRT-001", periodStart: "2026-06-28", periodEnd: "2026-07-04",
    rank: 1, productId: "P1", productInfo: "Produk A", shopId: "S1", shopName: "Toko A",
    level1Category: "F&B", level2Category: "Drinks", gmv: 1_000_000, orders: 8,
    liveGmv: 600_000, videoGmv: 400_000, itemsSold: 10, liveOrders: 5, videoOrders: 3,
    directGmv: 0, ctr: 0.05, ctor: 0.02,
  },
];

describe("writeAggregates (idempotensi per creator x periode, bukan per upload_batch)", () => {
  it("deletes scoped to creator_id + periode from all 3 aggregate tables BEFORE any insert", async () => {
    const ops: Op[] = [];
    await writeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, PERIOD_END, summary, subcat, top);

    const deletes = ops.filter((o) => o.op === "delete");
    expect(deletes.map((d) => d.table).sort()).toEqual([
      "creator_period_summary", "creator_subcat_segment_gmv", "creator_top_products",
    ]);
    // period_start-scoped tables: creator_period_summary + creator_top_products.
    for (const table of ["creator_period_summary", "creator_top_products"]) {
      const d = deletes.find((x) => x.table === table)!;
      expect(d.filters).toEqual([
        { column: "creator_id", value: CREATOR_IDS },
        { column: "period_start", value: PERIOD_START },
      ]);
    }
    // creator_subcat_segment_gmv has no period_start column — scoped by window_end instead.
    const subcatDelete = deletes.find((x) => x.table === "creator_subcat_segment_gmv")!;
    expect(subcatDelete.filters).toEqual([
      { column: "creator_id", value: CREATOR_IDS },
      { column: "window_end", value: PERIOD_END },
    ]);
    // delete-then-insert ordering: last delete precedes first insert.
    const lastDelete = ops.map((o) => o.op).lastIndexOf("delete");
    const firstInsert = ops.map((o) => o.op).indexOf("insert");
    expect(lastDelete).toBeLessThan(firstInsert);
  });

  it("stamps every inserted row with the upload_batch (re-upload replaces, not duplicates)", async () => {
    const ops: Op[] = [];
    await writeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, PERIOD_END, summary, subcat, top);

    const inserted = ops.filter((o) => o.op === "insert").flatMap((o) => o.rows ?? []);
    expect(inserted).toHaveLength(3); // 1 summary + 1 subcat + 1 top product
    for (const row of inserted) {
      expect((row as { upload_batch: string }).upload_batch).toBe(BATCH);
    }
  });

  it("maps aggregate fields to snake_case table columns", async () => {
    const ops: Op[] = [];
    await writeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, PERIOD_END, summary, subcat, top);

    const summaryInsert = ops.find((o) => o.op === "insert" && o.table === "creator_period_summary");
    expect(summaryInsert?.rows?.[0]).toMatchObject({
      creator_id: "CRT-001", affiliate_gmv: 1_000_000, affiliate_live_gmv: 600_000,
      live_pct: 0.6, gmv_total: 1_000_000, items_sold: 10,
    });
    const subcatInsert = ops.find((o) => o.op === "insert" && o.table === "creator_subcat_segment_gmv");
    expect(subcatInsert?.rows?.[0]).toMatchObject({
      creator_id: "CRT-001", level2_category: "Drinks", price_segment: "low", avg_price: 100_000,
    });
    const topInsert = ops.find((o) => o.op === "insert" && o.table === "creator_top_products");
    expect(topInsert?.rows?.[0]).toMatchObject({
      creator_id: "CRT-001", rank: 1, product_id: "P1", shop_id: "S1",
    });
  });

  it("does not insert when a batch has no rows (idempotent empty overwrite still clears)", async () => {
    const ops: Op[] = [];
    await writeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, PERIOD_END, [], [], []);
    expect(ops.filter((o) => o.op === "delete")).toHaveLength(3);
    expect(ops.filter((o) => o.op === "insert")).toHaveLength(0);
  });

  it("skips delete entirely when creatorIds is empty (no accidental table-wide delete)", async () => {
    const ops: Op[] = [];
    await writeAggregates(mockSupabase(ops), BATCH, [], PERIOD_START, PERIOD_END, [], [], []);
    expect(ops.filter((o) => o.op === "delete")).toHaveLength(0);
  });

  // ─── Regression: replace di-scope PER KREATOR PER MINGGU (keputusan final) ───
  it("regression: two uploads same week, different creator sets — first upload's creator is NOT deleted by the second", async () => {
    // CM Uma uploads 6 creators for the week; batch A.
    const opsA: Op[] = [];
    const umaCreatorIds = ["CRT-UMA-1"];
    const umaSummary: PeriodSummaryRow[] = [
      { ...summary[0], creatorId: "CRT-UMA-1" },
    ];
    await writeAggregates(
      mockSupabase(opsA), "ingest:2026-06-28:hashuma1", umaCreatorIds, PERIOD_START, PERIOD_END,
      umaSummary, subcat.map((s) => ({ ...s, creatorId: "CRT-UMA-1" })),
      top.map((t) => ({ ...t, creatorId: "CRT-UMA-1" }))
    );

    // A different CM uploads vikahere for the SAME week; batch B — must only
    // scope its delete to vikahere's creator_id, never touching CRT-UMA-1's rows.
    const opsB: Op[] = [];
    const vikaCreatorIds = ["CRT-VIKA-1"];
    const vikaSummary: PeriodSummaryRow[] = [
      { ...summary[0], creatorId: "CRT-VIKA-1" },
    ];
    await writeAggregates(
      mockSupabase(opsB), "ingest:2026-06-28:hashvika1", vikaCreatorIds, PERIOD_START, PERIOD_END,
      vikaSummary, subcat.map((s) => ({ ...s, creatorId: "CRT-VIKA-1" })),
      top.map((t) => ({ ...t, creatorId: "CRT-VIKA-1" }))
    );

    const deletesB = opsB.filter((o) => o.op === "delete");
    for (const d of deletesB) {
      const creatorFilter = d.filters!.find((f) => f.column === "creator_id");
      expect(creatorFilter?.value).toEqual(vikaCreatorIds);
      expect(creatorFilter?.value).not.toContain("CRT-UMA-1");
    }
    // batch A's own inserted rows are stamped with batch A's id, unaffected by batch B.
    const insertedA = opsA.filter((o) => o.op === "insert").flatMap((o) => o.rows ?? []);
    for (const row of insertedA) {
      expect((row as { upload_batch: string }).upload_batch).toBe("ingest:2026-06-28:hashuma1");
    }
  });

  it("regression: re-uploading the identical file (same batch_id) replaces via delete-then-insert, no duplication", async () => {
    const ops: Op[] = [];
    // Same batch_id both times (simulates hash8 being identical because file content is identical).
    await writeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, PERIOD_END, summary, subcat, top);
    await writeAggregates(mockSupabase(ops), BATCH, CREATOR_IDS, PERIOD_START, PERIOD_END, summary, subcat, top);

    // Each run deletes-then-inserts scoped to the same creator_id + period — the
    // second run's delete clears the first run's inserted rows before re-inserting,
    // so the net insert count per run stays at 1 row per table (no duplication).
    const inserts = ops.filter((o) => o.op === "insert");
    expect(inserts).toHaveLength(6); // 2 runs x (1 summary + 1 subcat + 1 top)
    const summaryInserts = inserts.filter((o) => o.table === "creator_period_summary");
    expect(summaryInserts).toHaveLength(2);
    for (const ins of summaryInserts) {
      expect(ins.rows).toHaveLength(1); // never accumulates duplicates within a single insert call
    }
  });
});

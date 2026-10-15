import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCreatorShopPeriod, buildPeriodSummary } from "../aggregate";
import { buildShopeeCreatorShopPeriod } from "../shopee-aggregate";
import { writeCreatorShopPeriod } from "../shop-period-write";
import { computeLeak } from "@/lib/m4/leak-compute";
import type { McnRow, TapRow } from "../schema";
import type { ShopeeRow } from "../shopee-csv";

function mcn(o: Partial<McnRow>): McnRow {
  return {
    date: "2026-09-01-2026-09-07", periodStart: "2026-09-01", periodEnd: "2026-09-07",
    creatorName: "CRT-A", followerCount: null, productId: "P1", productInfo: "Produk", shopId: "7001",
    shopName: "Toko Satu", level1Category: null, level2Category: "Serum", affiliateGmv: 0,
    affiliateLiveGmv: 0, affiliateVideoGmv: 0, orders: 0, liveOrders: 0, videoOrders: 0, directGmv: 0,
    itemsSold: 0, refundGmv: 0, ctr: null, ctor: null, liveDirectGmv: 0, liveDirectOrders: 0, liveItemsSold: 0,
    ...o,
  };
}
function tap(o: Partial<TapRow>): TapRow {
  return {
    periodStart: "2026-09-01", periodEnd: "2026-09-07", creatorName: "CRT-A", productId: "P1",
    productInfo: "Produk", shopId: "7001", shopName: "Toko Satu", level2Category: "Serum",
    affiliateGmv: 0, affiliateLiveGmv: 0, affiliateVideoGmv: 0, orders: 0, itemsSold: 0,
    estPartnerCommission: null, actualPartnerCommission: null, estCreatorCommission: null,
    actualCreatorCommission: null, refundGmv: 0, ...o,
  };
}

const MCN: McnRow[] = [
  mcn({ creatorName: "CRT-A", shopId: "7001", productId: "P1", affiliateGmv: 1_000_000, affiliateLiveGmv: 600_000, affiliateVideoGmv: 400_000, orders: 10, itemsSold: 12 }),
  mcn({ creatorName: "CRT-A", shopId: "7001", productId: "P2", affiliateGmv: 500_000, affiliateVideoGmv: 500_000, orders: 5, itemsSold: 5 }),
  mcn({ creatorName: "CRT-A", shopId: "7002", shopName: "Toko Dua", productId: "P3", affiliateGmv: 300_000, orders: 3, itemsSold: 3 }),
  mcn({ creatorName: "CRT-B", shopId: "7001", productId: "P1", affiliateGmv: 500_000, affiliateLiveGmv: 500_000, orders: 4, itemsSold: 4 }),
];
const TAP: TapRow[] = [
  tap({ creatorName: "CRT-A", shopId: "7001", productId: "P1", affiliateGmv: 800_000, affiliateLiveGmv: 500_000, affiliateVideoGmv: 300_000, orders: 8, actualPartnerCommission: 40_000, estPartnerCommission: 45_000 }),
  tap({ creatorName: "CRT-B", shopId: "7001", productId: "P1", affiliateGmv: 200_000, affiliateLiveGmv: 200_000, orders: 2, actualPartnerCommission: 10_000 }),
];

describe("buildCreatorShopPeriod (TikTok MCN + TAP)", () => {
  it("invariant: Σ gmv_mcn per kreator = creator_period_summary.affiliate_gmv", () => {
    const { rows } = buildCreatorShopPeriod(MCN, TAP, true);
    const summary = buildPeriodSummary(MCN);
    for (const s of summary) {
      const sum = rows.filter((r) => r.creatorId === s.creatorId).reduce((a, r) => a + r.gmvMcn, 0);
      expect(sum, s.creatorId).toBe(s.affiliateGmv);
    }
  });

  it("invariant: Σ gmv_tap per kreator = CreatorLeakRollup.gmvTap (analisa bocor, baris yang sama)", () => {
    const { rows, unattributedTapGmv } = buildCreatorShopPeriod(MCN, TAP, true);
    const leak = computeLeak({
      mcnRows: MCN, tapRows: TAP, master: new Map(), week: "2026-09-01",
      thresholds: { sebagian: 0.1, total: 0.5 },
    });
    expect(leak.creators.length).toBe(2);
    for (const r of leak.creators) {
      const sum = rows.filter((x) => x.creatorId === r.creatorName).reduce((a, x) => a + (x.gmvTap ?? 0), 0);
      expect(sum, r.creatorName).toBe(r.gmvTap);
    }
    expect(unattributedTapGmv).toBe(0);
  });

  it("satu baris per (kreator, shop) dengan live/video, orders, items, komisi partner", () => {
    const { rows } = buildCreatorShopPeriod(MCN, TAP, true);
    const a1 = rows.find((r) => r.creatorId === "CRT-A" && r.shopId === "7001")!;
    expect(a1).toMatchObject({
      shopName: "Toko Satu", gmvMcn: 1_500_000, gmvMcnLive: 600_000, gmvMcnVideo: 900_000,
      ordersMcn: 15, itemsSoldMcn: 17, gmvTap: 800_000, gmvTapLive: 500_000, gmvTapVideo: 300_000,
      ordersTap: 8, actualPartnerCommission: 40_000, estPartnerCommission: 45_000, estCreatorCommission: null,
    });
    // Ada file TAP tapi kreator × shop ini tidak pakai TAP → 0, bukan null.
    const a2 = rows.find((r) => r.creatorId === "CRT-A" && r.shopId === "7002")!;
    expect(a2.gmvTap).toBe(0);
    expect(a2.actualPartnerCommission).toBeNull();
    expect(rows).toHaveLength(3);
  });

  it("tanpa file TAP → semua kolom TAP null (bukan 0)", () => {
    const { rows } = buildCreatorShopPeriod(MCN, [], false);
    for (const r of rows) {
      expect(r.gmvTap).toBeNull();
      expect(r.ordersTap).toBeNull();
    }
  });

  it("TAP 1-kreator tanpa kolom kreator (\"\") → kreator file MCN (CLAUDE.md #5)", () => {
    const single = MCN.filter((r) => r.creatorName === "CRT-A");
    const { rows } = buildCreatorShopPeriod(single, [{ ...tap({ affiliateGmv: 300_000 }), creatorName: "" }], true);
    expect(rows.find((r) => r.shopId === "7001")!.gmvTap).toBe(300_000);
  });

  it("TAP tanpa kreator di file multi-kreator → TIDAK dibagi: per shop sebagai \"Nama kreator tidak ada\" (K6)", () => {
    const { rows, unattributed, unattributedTapGmv } = buildCreatorShopPeriod(
      MCN,
      [{ ...tap({ affiliateGmv: 400_000, affiliateLiveGmv: 100_000, orders: 4, actualPartnerCommission: 20_000 }), creatorName: "" }],
      true
    );
    // Kreator shop 7001 tetap 0 (file TAP ada, baris bernama tidak ada).
    expect(rows.find((r) => r.creatorId === "CRT-A" && r.shopId === "7001")!.gmvTap).toBe(0);
    expect(rows.find((r) => r.creatorId === "CRT-B" && r.shopId === "7001")!.gmvTap).toBe(0);
    expect(unattributed).toEqual([
      expect.objectContaining({
        shopId: "7001", shopName: "Toko Satu", gmvTap: 400_000, gmvTapLive: 100_000, ordersTap: 4,
        actualPartnerCommission: 20_000, estPartnerCommission: null,
      }),
    ]);
    expect(unattributedTapGmv).toBe(400_000);
  });

  it("nama TAP tak ter-resolve (null) & shop tanpa GMV MCN → ikut dicatat per shop, tidak ditebak", () => {
    const tapRows = [
      { ...tap({ affiliateGmv: 100_000 }), creatorName: null },
      { ...tap({ affiliateGmv: 50_000, shopId: "7999", shopName: "Toko Lain" }), creatorName: "" },
    ];
    const { rows, unattributed, unattributedTapGmv } = buildCreatorShopPeriod(MCN, tapRows, true);
    expect(unattributedTapGmv).toBe(150_000);
    expect(unattributed.map((u) => [u.shopId, u.gmvTap]).sort()).toEqual([["7001", 100_000], ["7999", 50_000]]);
    expect(rows.every((r) => r.shopId !== "7999")).toBe(true);
    // Invariant: Σ gmvTap kreator + Σ tanpa kreator = Σ TAP file.
    const sumRows = rows.reduce((a, r) => a + (r.gmvTap ?? 0), 0);
    expect(sumRows + unattributedTapGmv).toBe(150_000);
  });
});

describe("buildShopeeCreatorShopPeriod", () => {
  const s = (o: Partial<ShopeeRow>): ShopeeRow => ({
    orderDate: "2026-09-03", affiliateName: "A", affiliateUsername: "CRT-S", productId: "1", productName: null,
    shopId: "880", shopName: "Toko Shopee", level1Category: null, level2Category: null, gmv: 0, qty: 1,
    unitPrice: null, platform: "Shopeelive-Shopee", bucket: "live", ...o,
  });
  it("GMV MCN per (kreator, shop), TAP selalu NULL (fase 1, Q4)", () => {
    const rows = buildShopeeCreatorShopPeriod([
      s({ gmv: 100_000, bucket: "live", qty: 2 }),
      s({ gmv: 50_000, bucket: "video", qty: null }),
      s({ gmv: 30_000, bucket: "other", shopId: "881" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.shopId === "880")).toMatchObject({
      gmvMcn: 150_000, gmvMcnLive: 100_000, gmvMcnVideo: 50_000, ordersMcn: 2, itemsSoldMcn: 2,
      gmvTap: null, gmvTapLive: null, ordersTap: null, actualPartnerCommission: null,
    });
  });
});

// ─── writer ───
interface Op { table: string; op: "delete" | "insert" | "select"; filters: [string, unknown][]; rows?: unknown[] }
type MockErr = { code?: string; message: string } | null;
function mockAdmin(
  ops: Op[],
  error: MockErr | ((table: string) => MockErr) = null,
  selectData: Record<string, unknown>[] = []
): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => {
        const entry: Op = { table, op: "select", filters: [] };
        ops.push(entry);
        const err = typeof error === "function" ? error(table) : error;
        const chain = {
          eq: (c: string, v: unknown) => { entry.filters.push([c, v]); return chain; },
          in: (c: string, v: unknown) => {
            entry.filters.push([c, v]);
            return Promise.resolve({ data: err ? null : selectData, error: err });
          },
        };
        return chain;
      },
      delete: () => {
        const entry: Op = { table, op: "delete", filters: [] };
        ops.push(entry);
        const err = typeof error === "function" ? error(table) : error;
        const chain = {
          eq: (c: string, v: unknown) => { entry.filters.push([c, v]); return chain; },
          in: (c: string, v: unknown) => { entry.filters.push([c, v]); return Promise.resolve({ error: err }); },
          overlaps: (c: string, v: unknown) => { entry.filters.push([c, v]); return Promise.resolve({ error: err }); },
        };
        return chain;
      },
      insert: (rows: unknown[]) => {
        ops.push({ table, op: "insert", filters: [], rows });
        return Promise.resolve({ error: typeof error === "function" ? error(table) : error });
      },
    }),
  } as unknown as SupabaseClient;
}

describe("writeCreatorShopPeriod", () => {
  const { rows } = buildCreatorShopPeriod(MCN, TAP, true);

  it("delete per (platform, period_start, kreator file ini) lalu insert dengan cap platform/periode/batch", async () => {
    const ops: Op[] = [];
    const res = await writeCreatorShopPeriod(mockAdmin(ops), "tiktok", "ingest:2026-09-01:abcd", ["CRT-A", "CRT-B"], "2026-09-01", "2026-09-07", rows);
    expect(res).toEqual({ written: 3, skipped: null });
    expect(ops[0]).toMatchObject({
      op: "delete",
      filters: [["platform", "tiktok"], ["period_start", "2026-09-01"], ["creator_id", ["CRT-A", "CRT-B"]]],
    });
    expect(ops[1].op).toBe("insert");
    expect(ops[1].rows![0]).toMatchObject({
      platform: "tiktok", period_start: "2026-09-01", period_end: "2026-09-07",
      upload_batch: "ingest:2026-09-01:abcd", creator_id: "CRT-A", shop_id: "7001", gmv_mcn: 1_500_000, gmv_tap: 800_000,
    });
  });

  it("GMV TAP tanpa kreator → hapus batch ini + batch lama yang memuat kreator file ini, tulis lingkup per kreator lalu baris per shop", async () => {
    const res0 = buildCreatorShopPeriod(MCN, [{ ...tap({ affiliateGmv: 400_000 }), creatorName: "" }], true);
    const ops: Op[] = [];
    const res = await writeCreatorShopPeriod(
      mockAdmin(ops, null, [{ upload_batch: "ingest:2026-09-01:old1" }]),
      "tiktok", "ingest:2026-09-01:abcd", ["CRT-A", "CRT-B"], "2026-09-01", "2026-09-07", res0.rows, res0.unattributed
    );
    expect(res.skipped).toBeNull();
    const u = ops.filter((o) => o.table.startsWith("creator_shop_period_unattributed"));
    expect(u[0]).toMatchObject({
      table: "creator_shop_period_unattributed_scope", op: "select",
      filters: [["platform", "tiktok"], ["period_start", "2026-09-01"], ["creator_id", ["CRT-A", "CRT-B"]]],
    });
    const batches = [["platform", "tiktok"], ["upload_batch", ["ingest:2026-09-01:abcd", "ingest:2026-09-01:old1"]]];
    expect(u[1]).toMatchObject({ table: "creator_shop_period_unattributed_tap", op: "delete", filters: batches });
    expect(u[2]).toMatchObject({ table: "creator_shop_period_unattributed_scope", op: "delete", filters: batches });
    expect(u[3]).toMatchObject({ table: "creator_shop_period_unattributed_scope", op: "insert" });
    expect(u[3].rows).toEqual([
      { platform: "tiktok", upload_batch: "ingest:2026-09-01:abcd", period_start: "2026-09-01", creator_id: "CRT-A" },
      { platform: "tiktok", upload_batch: "ingest:2026-09-01:abcd", period_start: "2026-09-01", creator_id: "CRT-B" },
    ]);
    expect(u[4].op).toBe("insert");
    expect(u[4].table).toBe("creator_shop_period_unattributed_tap");
    expect(u[4].rows).toEqual([
      expect.objectContaining({
        platform: "tiktok", shop_id: "7001", period_start: "2026-09-01", upload_batch: "ingest:2026-09-01:abcd", gmv_tap: 400_000,
      }),
    ]);
    // Per-shop rows no longer carry the creator list (0089).
    expect(u[4].rows![0]).not.toHaveProperty("source_creator_ids");
  });

  it("tanpa baris tanpa-kreator → batch lama tetap dihapus, tidak ada lingkup yang ditulis", async () => {
    const ops: Op[] = [];
    await writeCreatorShopPeriod(mockAdmin(ops), "tiktok", "b", ["CRT-A"], "2026-09-01", "2026-09-07", rows);
    const u = ops.filter((o) => o.table.startsWith("creator_shop_period_unattributed"));
    expect(u.map((o) => `${o.op}:${o.table}`)).toEqual([
      "select:creator_shop_period_unattributed_scope",
      "delete:creator_shop_period_unattributed_tap",
      "delete:creator_shop_period_unattributed_scope",
    ]);
  });

  it("migrasi 0088/0089 belum ada → agregat per kreator tetap tertulis, GMV tanpa kreator dilaporkan", async () => {
    const res0 = buildCreatorShopPeriod(MCN, [{ ...tap({ affiliateGmv: 400_000 }), creatorName: "" }], true);
    const missing = (t: string) =>
      t === "creator_shop_period_unattributed_scope" ? { code: "PGRST205", message: "Could not find the table" } : null;
    const res = await writeCreatorShopPeriod(
      mockAdmin([], missing), "tiktok", "b", ["CRT-A", "CRT-B"], "2026-09-01", "2026-09-07", res0.rows, res0.unattributed
    );
    expect(res.written).toBe(res0.rows.length);
    expect(res.skipped).toMatch(/Migrasi 0088\/0089 belum di-apply/);
    // Tanpa baris tanpa-kreator, tabel yang belum ada tidak perlu dilaporkan.
    const quiet = await writeCreatorShopPeriod(mockAdmin([], missing), "tiktok", "b", ["CRT-A"], "2026-09-01", "2026-09-07", res0.rows);
    expect(quiet.skipped).toBeNull();
  });

  it("tabel belum ada (migrasi 0087 belum di-apply) → dilewati dengan pesan, TIDAK melempar", async () => {
    const ops: Op[] = [];
    const res = await writeCreatorShopPeriod(
      mockAdmin(ops, { code: "PGRST205", message: "Could not find the table 'public.creator_shop_period_gmv' in the schema cache" }),
      "tiktok", "b", ["CRT-A"], "2026-09-01", "2026-09-07", rows
    );
    expect(res.written).toBe(0);
    expect(res.skipped).toMatch(/Migrasi 0087 belum di-apply/);
  });

  it("error lain tetap melempar (agregat tidak boleh setengah tertulis diam-diam)", async () => {
    await expect(
      writeCreatorShopPeriod(mockAdmin([], { code: "42501", message: "permission denied" }), "tiktok", "b", ["CRT-A"], "2026-09-01", "2026-09-07", rows)
    ).rejects.toThrow(/permission denied/);
  });
});

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BREAKDOWN_LIMIT, loadBizdevSummary, toBizdevBreakdown, toBizdevCards,
  type BizdevBreakdownViewRow, type BizdevMemberRow,
} from "../bizdev-summary";
import { parsePeriodParam } from "../period";

const m = (o: Partial<BizdevMemberRow>): BizdevMemberRow => ({
  member_id: null, member_name: null, brand_count: 1, gmv_mcn: 0, gmv_mcn_tap_known: 0,
  gmv_mcn_tap_unknown: 0, gmv_tap: null, actual_partner_commission: null, ...o,
});

const b = (o: Partial<BizdevBreakdownViewRow>): BizdevBreakdownViewRow => ({
  member_id: null, member_name: null, brand_key: "tiktok:A", shop_key: "tiktok:A", platform: "tiktok",
  shop_name: "A", creator_count: 0, creator_tap_count: 0, gmv_mcn: 0, gmv_mcn_tap_known: 0,
  gmv_mcn_tap_unknown: 0, gmv_tap: null, actual_partner_commission: null, ...o,
});

describe("toBizdevCards", () => {
  it("Non BD Handle terakhir, sisanya urut GMV MCN; angka string dari PostgREST dibaca sebagai number", () => {
    const cards = toBizdevCards([
      m({ brand_count: 51313, gmv_mcn: "9999999" }),
      m({ member_id: "u2", member_name: "Budi", gmv_mcn: "1000", gmv_mcn_tap_known: "1000", gmv_tap: "600" }),
      m({ member_id: "u1", member_name: "Rina", brand_count: "3", gmv_mcn: "3500", gmv_mcn_tap_known: "1500", gmv_mcn_tap_unknown: "2000", gmv_tap: "700", actual_partner_commission: "30" }),
    ]);
    expect(cards.map((c) => c.memberName)).toEqual(["Rina", "Budi", "Non BD Handle"]);
    expect(cards[0]).toMatchObject({ brandCount: 3, gmvMcn: 3500, gmvMcnTapKnown: 1500, gmvMcnTapUnknown: 2000, gmvTap: 700, actualRevenuePartner: 30 });
    expect(cards[0].tapShare).toBeCloseTo(700 / 1500);
    expect(cards[2]).toMatchObject({ memberId: null, brandCount: 51313 });
  });

  it("GMV TAP null (Shopee) bukan nol → %TAP/MCN null", () => {
    const [c] = toBizdevCards([m({ member_id: "u1", member_name: "Rina", gmv_mcn: 2000, gmv_mcn_tap_unknown: 2000, gmv_tap: null })]);
    expect(c.gmvTap).toBeNull();
    expect(c.tapShare).toBeNull();
  });

  it("handler non-aktif (nama null) tampil '—', bukan Non BD Handle", () => {
    expect(toBizdevCards([m({ member_id: "u9", member_name: null })])[0].memberName).toBe("—");
  });
});

describe("toBizdevBreakdown", () => {
  it("kunci unik per (BizDev × brand); shop tanpa kartu/deal = Non BD Handle", () => {
    const rows = toBizdevBreakdown([
      b({ member_id: "u1", member_name: "Rina", creator_count: "3", creator_tap_count: "2", gmv_mcn: "1000" }),
      b({ member_id: "u2", member_name: "Budi" }),
      b({ brand_key: "shop:tiktok:9001", shop_key: null, shop_name: "#9001" }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["u1|tiktok:A", "u2|tiktok:A", "__non_bd__|shop:tiktok:9001"]);
    expect(rows[0]).toMatchObject({ creatorCount: 3, creatorTapCount: 2, gmvMcn: 1000 });
    expect(rows[2]).toMatchObject({ memberName: "Non BD Handle", shopKey: null, shopName: "#9001" });
  });
});

function fake(results: Record<string, { data?: unknown[]; error?: { code: string; message: string } | null }>) {
  const calls: [string, string, unknown][] = [];
  const client = {
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      for (const fn of ["select", "eq", "ilike", "order", "limit"]) {
        q[fn] = (...a: unknown[]) => { calls.push([t, fn, a]); return q; };
      }
      q.then = (res: (v: unknown) => unknown) => res({ data: results[t]?.data ?? [], error: results[t]?.error ?? null });
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("loadBizdevSummary", () => {
  const month = parsePeriodParam("2026-10", "2026-10-18");

  it("dua query agregat (bukan semua baris shop): filter periode, member, pencarian per kata, top-N", async () => {
    const f = fake({
      bizdev_member_summary: { data: [m({ member_id: "u1", member_name: "Rina", brand_count: 2 }), m({ brand_count: 5 })] },
      bizdev_brand_breakdown: { data: [b({ member_id: "u1" })] },
    });
    const r = await loadBizdevSummary(f.client, month, { memberId: "u1", search: "glow skin" });
    expect(r.missing).toBe(false);
    expect(r.breakdownTotal).toBe(7);
    expect(r.breakdown).toHaveLength(1);
    for (const t of ["bizdev_member_summary", "bizdev_brand_breakdown"]) {
      expect(f.calls).toContainEqual([t, "eq", ["period_kind", "month"]]);
      expect(f.calls).toContainEqual([t, "eq", ["period_key", "2026-10-01"]]);
      expect(f.calls).toContainEqual([t, "eq", ["member_id", "u1"]]);
    }
    expect(f.calls).toContainEqual(["bizdev_brand_breakdown", "ilike", ["search_text", "%glow%"]]);
    expect(f.calls).toContainEqual(["bizdev_brand_breakdown", "ilike", ["search_text", "%skin%"]]);
    expect(f.calls).toContainEqual(["bizdev_brand_breakdown", "limit", [BREAKDOWN_LIMIT]]);
    expect(f.calls.filter(([t, fn]) => t === "bizdev_member_summary" && fn === "ilike")).toEqual([]);
  });

  it("tanpa memberId tidak memfilter member (Management / BizDev Lead)", async () => {
    const f = fake({});
    await loadBizdevSummary(f.client, month);
    expect(f.calls.some(([, fn, a]) => fn === "eq" && (a as unknown[])[0] === "member_id")).toBe(false);
  });

  it("view 0096 belum ada → missing, bukan crash", async () => {
    const f = fake({ bizdev_member_summary: { error: { code: "PGRST205", message: "Could not find the table in the schema cache" } } });
    expect(await loadBizdevSummary(f.client, month)).toEqual({ cards: [], breakdown: [], breakdownTotal: 0, missing: true });
  });

  it("error lain dilempar", async () => {
    const f = fake({ bizdev_brand_breakdown: { error: { code: "57014", message: "canceling statement due to statement timeout" } } });
    await expect(loadBizdevSummary(f.client, month)).rejects.toThrow(/statement timeout/);
  });
});

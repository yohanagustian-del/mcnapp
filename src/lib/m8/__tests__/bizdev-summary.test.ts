import { describe, expect, it } from "vitest";
import { buildBizdevSummary, type BizdevPerfRow } from "../bizdev-summary";

const r = (o: Partial<BizdevPerfRow>): BizdevPerfRow => ({
  platform: "tiktok", shop_id: "1", shop_name: "Toko", shop_key: "tiktok:Toko", creator_count: 1,
  creator_tap_count: 0, gmv_mcn: 0, gmv_tap: 0, actual_partner_commission: null,
  member_id: null, member_name: null, ...o,
});

describe("buildBizdevSummary", () => {
  const rows: BizdevPerfRow[] = [
    // Brand A dipegang Rina & Budi → dihitung penuh di keduanya.
    r({ shop_key: "tiktok:A", shop_name: "A", shop_id: "1", gmv_mcn: "1000", gmv_tap: "600", actual_partner_commission: "30", member_id: "u1", member_name: "Rina", creator_count: 3, creator_tap_count: 2 }),
    r({ shop_key: "tiktok:A", shop_name: "A", shop_id: "1", gmv_mcn: "1000", gmv_tap: "600", actual_partner_commission: "30", member_id: "u2", member_name: "Budi", creator_count: 3, creator_tap_count: 2 }),
    r({ shop_key: "tiktok:B", shop_name: "B", shop_id: "2", gmv_mcn: 500, gmv_tap: 100, member_id: "u1", member_name: "Rina" }),
    // Shopee: GMV TAP null → tidak masuk penyebut %TAP.
    r({ platform: "shopee", shop_key: "shopee:C", shop_name: "C", shop_id: "3", gmv_mcn: 2000, gmv_tap: null, member_id: "u1", member_name: "Rina" }),
    // Tanpa handler.
    r({ shop_key: "tiktok:D", shop_name: "D", shop_id: "4", gmv_mcn: 9999, gmv_tap: 0 }),
  ];

  it("kartu per BizDev: brand dihandle, GMV MCN/TAP, revenue partner, %TAP/MCN; Non BD Handle terakhir", () => {
    const { cards } = buildBizdevSummary(rows);
    expect(cards.map((c) => c.memberName)).toEqual(["Rina", "Budi", "Non BD Handle"]);
    const rina = cards[0];
    expect(rina).toMatchObject({
      brandCount: 3, gmvMcn: 3500, gmvMcnTapKnown: 1500, gmvMcnTapUnknown: 2000, gmvTap: 700, actualRevenuePartner: 30,
    });
    expect(rina.tapShare).toBeCloseTo(700 / 1500);
    expect(cards[1]).toMatchObject({ brandCount: 1, gmvMcn: 1000, gmvTap: 600 });
    expect(cards[2]).toMatchObject({ memberId: null, brandCount: 1, gmvTap: 0, tapShare: 0, actualRevenuePartner: null });
  });

  it("breakdown satu baris per (BizDev × brand), Shopee tanpa %TAP", () => {
    const { breakdown } = buildBizdevSummary(rows);
    expect(breakdown).toHaveLength(5);
    const c = breakdown.find((b) => b.shopKey === "shopee:C")!;
    expect(c.gmvTap).toBeNull();
    expect(c.tapShare).toBeNull();
    const aRina = breakdown.find((b) => b.shopKey === "tiktok:A" && b.memberName === "Rina")!;
    expect(aRina).toMatchObject({ creatorCount: 3, creatorTapCount: 2, gmvMcn: 1000 });
  });

  it("tanpa baris → kosong", () => {
    expect(buildBizdevSummary([])).toEqual({ cards: [], breakdown: [] });
  });
});

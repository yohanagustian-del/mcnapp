import { describe, expect, it } from "vitest";
import { CAMPAIGN_TYPE_NEEDS_BUDGET } from "@/lib/deals/campaign-type";
import { planShopCardEdit, shopEditSchema, type ShopCardRow } from "@/lib/deals/shop-edit";

/** Kartu produk apa adanya dari products_tap. */
function card(over: Partial<ShopCardRow> = {}): ShopCardRow {
  return {
    campaign_id: "-",
    product_id: "1001",
    shop_id: null,
    campaign_type: null,
    ads_budget: null,
    service_fee: null,
    ...over,
  };
}

describe("form Edit shop (tabel Shop dari Produk TAP)", () => {
  it("Shop ID diisikan ke SEMUA kartu shop, kartu yang sudah benar tidak ditulis ulang", () => {
    const rows = [
      card({ product_id: "1", shop_id: null }),
      card({ product_id: "2", shop_id: "749", campaign_id: "CMP-1" }),
      card({ product_id: "3", shop_id: "7495123456789" }),
    ];
    const { updates, blocked } = planShopCardEdit(rows, { shop_id: "7495123456789" });

    expect(blocked).toEqual([]);
    expect(updates.map((u) => u.product_id)).toEqual(["1", "2"]);
    expect(updates[1]).toEqual({
      campaign_id: "CMP-1",
      product_id: "2",
      patch: { shop_id: "7495123456789" },
    });
  });

  it("Tipe Campaign diterapkan ke semua kartu shop", () => {
    const rows = [card({ product_id: "1" }), card({ product_id: "2", campaign_type: "sample" })];
    const { updates } = planShopCardEdit(rows, { campaign_type: "sample" });

    expect(updates).toEqual([
      { campaign_id: "-", product_id: "1", patch: { campaign_type: "sample" } },
    ]);
  });

  it("Paid Campaign: nominal hanya MENGISI kartu kosong, tidak menimpa yang sudah ada", () => {
    const rows = [
      card({ product_id: "1" }),
      card({ product_id: "2", ads_budget: 10_000_000, service_fee: 1_000_000 }),
    ];
    const { updates, blocked } = planShopCardEdit(rows, {
      campaign_type: CAMPAIGN_TYPE_NEEDS_BUDGET,
      ads_budget: 50_000_000,
      service_fee: 5_000_000,
    });

    expect(blocked).toEqual([]);
    expect(updates).toEqual([
      {
        campaign_id: "-",
        product_id: "1",
        patch: {
          campaign_type: "paid",
          ads_budget: 50_000_000,
          service_fee: 5_000_000,
        },
      },
      // Nominalnya sudah ada → hanya tipe campaign yang berubah.
      { campaign_id: "-", product_id: "2", patch: { campaign_type: "paid" } },
    ]);
  });

  it("Paid Campaign tanpa nominal → kartu kosong diblokir (edit dibatalkan seluruhnya)", () => {
    const rows = [card({ product_id: "1" }), card({ product_id: "2", ads_budget: 1, service_fee: 2 })];
    const { updates, blocked } = planShopCardEdit(rows, {
      campaign_type: CAMPAIGN_TYPE_NEEDS_BUDGET,
    });

    expect(blocked).toEqual([{ product_id: "1", fields: ["ads_budget", "service_fee"] }]);
    // Kartu lain tetap dihitung, tapi caller wajib membatalkan begitu blocked terisi.
    expect(updates.map((u) => u.product_id)).toEqual(["2"]);
  });

  it("mengisi Shop ID saja tidak diblokir kartu paid lama yang nominalnya kosong", () => {
    // Kalau aturan paid ditegakkan retroaktif di sini, Shop ID yang salah tidak akan
    // pernah bisa dibetulkan hanya karena ada kartu lama yang belum lengkap.
    const rows = [card({ product_id: "1", campaign_type: "paid" })];
    const { updates, blocked } = planShopCardEdit(rows, { shop_id: "749" });

    expect(blocked).toEqual([]);
    expect(updates).toEqual([{ campaign_id: "-", product_id: "1", patch: { shop_id: "749" } }]);
  });

  it("nominal diabaikan kalau tipe campaign tidak ditegaskan", () => {
    const rows = [card({ product_id: "1" })];
    const { updates } = planShopCardEdit(rows, { shop_id: "749", ads_budget: 50_000_000 });

    expect(updates).toEqual([{ campaign_id: "-", product_id: "1", patch: { shop_id: "749" } }]);
  });

  it("isian kosong = jangan ubah; Shop ID wajib angka", () => {
    const parsed = shopEditSchema.parse({
      shop_key: "Skintific Official Store",
      shop_id: "",
      campaign_type: "",
      ads_budget: "",
      service_fee: "",
    });
    expect(parsed.shop_id).toBeUndefined();
    expect(parsed.campaign_type).toBeUndefined();
    expect(parsed.ads_budget).toBeUndefined();

    const invalid = shopEditSchema.safeParse({ shop_key: "X", shop_id: "749-abc" });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues[0].path[0]).toBe("shop_id");
  });

  it("ads budget 0 adalah jawaban sah, bukan kosong", () => {
    const parsed = shopEditSchema.parse({
      shop_key: "X",
      campaign_type: CAMPAIGN_TYPE_NEEDS_BUDGET,
      ads_budget: "0",
      service_fee: "0",
    });
    const { blocked, updates } = planShopCardEdit([card()], parsed);
    expect(blocked).toEqual([]);
    expect(updates[0].patch).toMatchObject({ ads_budget: 0, service_fee: 0 });
  });
});

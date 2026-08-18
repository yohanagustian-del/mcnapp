import { describe, expect, it } from "vitest";
import { planShopCardEdit, shopEditSchema, type ShopCardRow } from "@/lib/deals/shop-edit";

/** Kartu produk apa adanya dari products_tap. */
function card(over: Partial<ShopCardRow> = {}): ShopCardRow {
  return {
    campaign_id: "-",
    product_id: "1001",
    shop_id: null,
    campaign_type: null,
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
    const { updates } = planShopCardEdit(rows, { shop_id: "7495123456789" });

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

  it("Tipe Campaign paid boleh dipilih tanpa nominal — nominal diatur di tab Project BD", () => {
    const rows = [card({ product_id: "1" }), card({ product_id: "2" })];
    const { updates } = planShopCardEdit(rows, { campaign_type: "paid" });

    expect(updates).toEqual([
      { campaign_id: "-", product_id: "1", patch: { campaign_type: "paid" } },
      { campaign_id: "-", product_id: "2", patch: { campaign_type: "paid" } },
    ]);
  });

  it("Shop ID + Tipe Campaign digabung dalam satu patch per kartu", () => {
    const rows = [card({ product_id: "1", shop_id: "1", campaign_type: "sample" })];
    const { updates } = planShopCardEdit(rows, { shop_id: "749", campaign_type: "paid" });

    expect(updates).toEqual([
      { campaign_id: "-", product_id: "1", patch: { shop_id: "749", campaign_type: "paid" } },
    ]);
  });

  it("isian kosong = jangan ubah; Shop ID wajib angka", () => {
    const parsed = shopEditSchema.parse({
      shop_key: "Skintific Official Store",
      shop_id: "",
      campaign_type: "",
    });
    expect(parsed.shop_id).toBeUndefined();
    expect(parsed.campaign_type).toBeUndefined();

    const invalid = shopEditSchema.safeParse({ shop_key: "X", shop_id: "749-abc" });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues[0].path[0]).toBe("shop_id");
  });
});

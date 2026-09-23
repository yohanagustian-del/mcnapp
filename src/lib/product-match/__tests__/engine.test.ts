import { describe, expect, it } from "vitest";
import type { PriceBounds } from "@/lib/projection/gmv";
import {
  categoryProfile,
  matchProducts,
  normalizePxProduct,
  normalizeTapProduct,
  type CreatorSubcatRow,
  type MatchableProduct,
  type ProductTapRow,
} from "../engine";

const BOUNDS: PriceBounds = { low: 180000, entry: 800000, sweet: 3600000, high: 8000000 };

describe("categoryProfile", () => {
  it("agregasi per kategori, hitung AOV, dan urut GMV desc", () => {
    const rows: CreatorSubcatRow[] = [
      { level2_category: "Fashion Wanita", gmv: 5_000_000, orders: 10 }, // aov 500rb -> entry
      { level2_category: "fashion wanita", gmv: 3_000_000, orders: 6 }, // baris kedua kategori sama (case beda)
      { level2_category: "Kecantikan", gmv: 20_000_000, orders: 5 }, // aov 4jt -> high
    ];
    const profiles = categoryProfile(rows, BOUNDS);
    expect(profiles).toHaveLength(2);
    // Kecantikan (gmv 20jt) harus di atas Fashion Wanita (gmv gabungan 8jt)
    expect(profiles[0].lvl2).toBe("Kecantikan");
    expect(profiles[0].aov).toBe(4_000_000);
    expect(profiles[0].segment).toBe("high");
    expect(profiles[1].lvl2).toBe("Fashion Wanita");
    expect(profiles[1].gmv).toBe(8_000_000);
    expect(profiles[1].orders).toBe(16);
    expect(profiles[1].aov).toBe(500_000);
    expect(profiles[1].segment).toBe("entry");
  });

  it("melewati kategori dengan total orders <= 0 (AOV tidak terdefinisi)", () => {
    const rows: CreatorSubcatRow[] = [{ level2_category: "Elektronik", gmv: 1_000_000, orders: 0 }];
    expect(categoryProfile(rows, BOUNDS)).toHaveLength(0);
  });

  it("mengabaikan baris tanpa kategori", () => {
    const rows: CreatorSubcatRow[] = [{ level2_category: null, gmv: 1_000_000, orders: 5 }];
    expect(categoryProfile(rows, BOUNDS)).toHaveLength(0);
  });
});

describe("normalizeTapProduct", () => {
  const base: ProductTapRow = {
    product_id: "P1",
    product_name: "Serum X",
    level2_category: "Kecantikan",
    affiliate_gmv: 4_000_000,
    orders: 10,
    price: 500_000,
    campaign_name: "Kampanye A",
    shop_name: "Toko A",
    commission_pct: 12,
    product_link: "https://tiktok.com/p1",
  };

  it("AOV dari performa (affiliate_gmv/orders) saat orders > 0", () => {
    const p = normalizeTapProduct(base);
    expect(p?.aov).toBe(400_000);
    expect(p?.aovSource).toBe("performance");
  });

  it("fallback ke price saat orders/gmv kosong (kartu belum punya performa)", () => {
    const p = normalizeTapProduct({ ...base, affiliate_gmv: null, orders: 0 });
    expect(p?.aov).toBe(500_000);
    expect(p?.aovSource).toBe("price");
  });

  it("null saat AOV performa maupun price tidak tersedia", () => {
    const p = normalizeTapProduct({ ...base, affiliate_gmv: null, orders: 0, price: null });
    expect(p).toBeNull();
  });

  it("null saat kategori kosong", () => {
    expect(normalizeTapProduct({ ...base, level2_category: null })).toBeNull();
  });
});

describe("normalizePxProduct", () => {
  it("tidak punya AOV/orders; membawa sudah_afiliasi & nama toko", () => {
    const p = normalizePxProduct({
      platform_product_id: "PX1",
      nama_produk: "Produk PX",
      level2_category: "Kecantikan",
      price_segment: "high",
      nama_toko: "Toko PX",
      sudah_afiliasi: true,
    });
    expect(p?.source).toBe("px");
    expect(p?.aov).toBeNull();
    expect(p?.orders).toBe(0);
    expect(p?.sudahAfiliasi).toBe(true);
    expect(p?.shopName).toBe("Toko PX");
  });
});

describe("matchProducts", () => {
  const profile = categoryProfile(
    [{ level2_category: "Kecantikan", gmv: 20_000_000, orders: 5 }], // aov 4jt -> high
    BOUNDS
  );

  it("cocok kategori sama (case-insensitive) & segmen sama, urut orders desc, top N", () => {
    const products: MatchableProduct[] = [
      { source: "tap", productId: "A", productName: "A", level2Category: "kecantikan", aov: 4_100_000, aovSource: "performance", orders: 5, campaignName: null, shopName: null, commissionPct: null, productLink: null, sudahAfiliasi: null },
      { source: "tap", productId: "B", productName: "B", level2Category: "Kecantikan", aov: 3_900_000, aovSource: "performance", orders: 50, campaignName: null, shopName: null, commissionPct: null, productLink: null, sudahAfiliasi: null },
      { source: "tap", productId: "C", productName: "C low-segment", level2Category: "Kecantikan", aov: 100_000, aovSource: "performance", orders: 999, campaignName: null, shopName: null, commissionPct: null, productLink: null, sudahAfiliasi: null }, // beda segmen -> tidak ikut
      { source: "tap", productId: "D", productName: "D beda kategori", level2Category: "Fashion Pria", aov: 4_000_000, aovSource: "performance", orders: 999, campaignName: null, shopName: null, commissionPct: null, productLink: null, sudahAfiliasi: null },
    ];
    const result = matchProducts(profile, products, BOUNDS, 8);
    expect(result.categories).toHaveLength(1);
    const ids = result.categories[0].products.map((p) => p.productId);
    expect(ids).toEqual(["B", "A"]); // orders desc, C (segmen beda) & D (kategori beda) tidak ikut
  });

  it("memotong ke topN", () => {
    const products: MatchableProduct[] = Array.from({ length: 12 }, (_, i) => ({
      source: "tap" as const,
      productId: `T${i}`,
      productName: `T${i}`,
      level2Category: "Kecantikan",
      aov: 4_000_000,
      aovSource: "performance" as const,
      orders: 12 - i,
      campaignName: null,
      shopName: null,
      commissionPct: null,
      productLink: null,
      sudahAfiliasi: null,
    }));
    const result = matchProducts(profile, products, BOUNDS, 8);
    expect(result.categories[0].products).toHaveLength(8);
    expect(result.categories[0].products[0].productId).toBe("T0");
  });

  it("PX diselipkan setelah TAP, diurut sudah_afiliasi lalu nama, dengan label sumber", () => {
    const products: MatchableProduct[] = [
      { source: "tap", productId: "T1", productName: "TAP1", level2Category: "Kecantikan", aov: 4_000_000, aovSource: "performance", orders: 5, campaignName: null, shopName: null, commissionPct: null, productLink: null, sudahAfiliasi: null },
      { source: "px", productId: "PX-B", productName: "B belum afiliasi", level2Category: "Kecantikan", aov: null, aovSource: null, orders: 0, campaignName: null, shopName: "Toko B", commissionPct: null, productLink: null, sudahAfiliasi: false },
      { source: "px", productId: "PX-A", productName: "A sudah afiliasi", level2Category: "Kecantikan", aov: null, aovSource: null, orders: 0, campaignName: null, shopName: "Toko A", commissionPct: null, productLink: null, sudahAfiliasi: true },
    ];
    const result = matchProducts(profile, products, BOUNDS, 8);
    const ids = result.categories[0].products.map((p) => p.productId);
    expect(ids).toEqual(["T1", "PX-A", "PX-B"]); // TAP dulu, lalu PX sudah_afiliasi dulu
    const pxA = result.categories[0].products.find((p) => p.productId === "PX-A");
    expect(pxA?.sourceLabel).toBe("Seller manage by MEA");
    const tap1 = result.categories[0].products.find((p) => p.productId === "T1");
    expect(tap1?.sourceLabel).toBeNull();
  });

  it("summary: totalGmv, totalOrders, categoryCount, segmentCounts", () => {
    const twoCategories = categoryProfile(
      [
        { level2_category: "Kecantikan", gmv: 20_000_000, orders: 5 }, // high
        { level2_category: "Fashion Wanita", gmv: 5_000_000, orders: 10 }, // entry
      ],
      BOUNDS
    );
    const result = matchProducts(twoCategories, [], BOUNDS, 8);
    expect(result.summary.totalGmv).toBe(25_000_000);
    expect(result.summary.totalOrders).toBe(15);
    expect(result.summary.categoryCount).toBe(2);
    expect(result.summary.segmentCounts).toEqual({ high: 1, entry: 1 });
  });
});

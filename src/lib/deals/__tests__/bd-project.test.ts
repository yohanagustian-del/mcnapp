import { describe, expect, it } from "vitest";
import {
  bdProjectSchema,
  parseShopKeys,
  PROJECT_STATUS_LABEL,
  sumProjectShops,
  type ProjectShopMetrics,
} from "@/lib/deals/bd-project";

function shop(over: Partial<ProjectShopMetrics> = {}): ProjectShopMetrics {
  return {
    product_count: 0,
    active_count: 0,
    needs_review_count: 0,
    campaign_count: 0,
    ads_budget: null,
    service_fee: null,
    gmv_tap: null,
    effective_start: null,
    effective_end: null,
    ...over,
  };
}

describe("form Project BD", () => {
  it("nama wajib; status default running", () => {
    const parsed = bdProjectSchema.parse({ project_id: "", name: " Payday Agustus " });
    expect(parsed.name).toBe("Payday Agustus");
    expect(parsed.status).toBe("running");
    // project_id kosong = menambah project baru, bukan mengubah project ""
    expect(parsed.project_id).toBeUndefined();
    expect(parsed.notes).toBeUndefined();

    const invalid = bdProjectSchema.safeParse({ name: "   " });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues[0].path[0]).toBe("name");
  });

  it("tiga status dengan label yang dipakai UI", () => {
    expect(PROJECT_STATUS_LABEL.running).toBe("Running");
    expect(PROJECT_STATUS_LABEL.hold).toBe("Hold");
    expect(PROJECT_STATUS_LABEL.done).toBe("Done");
    expect(bdProjectSchema.safeParse({ name: "X", status: "batal" }).success).toBe(false);
  });
});

describe("daftar shop terpilih", () => {
  it("membaca JSON array, membuang duplikat & nilai rusak", () => {
    const keys = parseShopKeys(
      JSON.stringify(["Toko A", "Toko A", "  Toko B  ", "", 42, null, "#7495"])
    );
    expect(keys).toEqual(["Toko A", "Toko B", "#7495"]);
  });

  it("shop_key boleh memuat koma — itu sebabnya JSON, bukan gabungan berpemisah", () => {
    expect(parseShopKeys(JSON.stringify(["Toko A, Cabang 2"]))).toEqual(["Toko A, Cabang 2"]);
  });

  it("menolak isian yang bukan JSON array", () => {
    expect(() => parseShopKeys("bukan json")).toThrow();
    expect(() => parseShopKeys(JSON.stringify({ a: 1 }))).toThrow();
  });
});

describe("total project = penjumlahan ringkasan shop", () => {
  it("nominal dijumlah, masa berlaku diambil rentang gabungannya", () => {
    const totals = sumProjectShops([
      shop({
        product_count: 3,
        active_count: 2,
        campaign_count: 1,
        ads_budget: 10_000_000,
        gmv_tap: 5_000_000,
        effective_start: "2026-02-01",
        effective_end: "2026-03-01",
      }),
      shop({
        product_count: 2,
        active_count: 2,
        needs_review_count: 1,
        campaign_count: 2,
        ads_budget: 5_000_000,
        service_fee: 1_000_000,
        effective_start: "2026-01-15",
        effective_end: "2026-02-20",
      }),
    ]);

    expect(totals).toEqual({
      shop_count: 2,
      product_count: 5,
      active_count: 4,
      needs_review_count: 1,
      campaign_count: 3,
      ads_budget: 15_000_000,
      service_fee: 1_000_000,
      gmv_tap: 5_000_000,
      effective_start: "2026-01-15",
      effective_end: "2026-03-01",
    });
  });

  it('null tetap null — "belum ada data" tidak tersamar jadi nol', () => {
    const totals = sumProjectShops([shop(), shop()]);
    expect(totals.ads_budget).toBeNull();
    expect(totals.service_fee).toBeNull();
    expect(totals.gmv_tap).toBeNull();
    expect(totals.effective_end).toBeNull();
    expect(totals.product_count).toBe(0);

    // Satu shop punya angka, satu belum → hasilnya angka itu, bukan null.
    expect(sumProjectShops([shop(), shop({ gmv_tap: 0 })]).gmv_tap).toBe(0);
  });

  it("project tanpa shop = semua nol/null", () => {
    expect(sumProjectShops([])).toMatchObject({ shop_count: 0, product_count: 0, gmv_tap: null });
  });
});

import { describe, expect, it } from "vitest";
import {
  bizdevFromLabel,
  brandFilterOptions,
  buildBrandRows,
  filterBrandRows,
  NON_BD_FILTER,
  NON_OPS_FILTER,
  paginate,
  sortBrandRows,
  type BrandDealSource,
} from "../brand-table";

const base: BrandDealSource = {
  id: "DEAL-1", platform: "tiktok", brand_name: "Glow Lab", shop_id: "7495", shop_key: "glow lab",
  bizdev_label: "Non BD Hande", status: "running", niche: "Beauty", brand_link: null, contact_pic_brand: null,
  nama_grup: null, gmv_tap: "1500000", avg_price: null, support_types: ["sample"], ads_brand: null,
  leads_type: null, priority: "P1", working_sheet: null, campaign_ops_id: null, campaign_name: null,
  campaign_id: null, exp_date: "2026-11-01", shop_code: "IDLC1",
};

const ctx = (handlers: [string, string[]][] = []) => ({
  handlersByShopKey: new Map(handlers.map(([k, names]) => [k, names.map((name) => ({ name }))])),
  memberNameById: new Map([["u-ops", "Diena Shofwah"]]),
  today: "2026-10-22",
});

describe("brand-table", () => {
  it("label sheet: Non BD = kosong, nama dipisah koma", () => {
    expect(bizdevFromLabel("Non BD Hande")).toEqual([]);
    expect(bizdevFromLabel("Fanny, Laila S")).toEqual(["Fanny", "Laila S"]);
    expect(bizdevFromLabel(null)).toEqual([]);
  });

  it("handler akun menang atas label sheet; status lama dinormalisasi; countdown dihitung", () => {
    const [r] = buildBrandRows([{ ...base, bizdev_label: "Alya" }], ctx([["glow lab", ["Laila S"]]]));
    expect(r.bizdev).toEqual(["Laila S"]);
    expect(r.status).toBe("running_1st_month");
    expect(r.countdown).toBe(10);
    expect(r.gmvTap).toBe(1_500_000);
  });

  it("tanpa kolom 0097 tetap jalan", () => {
    const { support_types: _s, working_sheet: _w, campaign_ops_id: _c, bizdev_label: _b, ...pre } = base;
    const [r] = buildBrandRows([pre], ctx());
    expect(r.supportTypes).toEqual([]);
    expect(r.campaignOps).toBeNull();
    expect(r.bizdev).toEqual([]);
  });

  const rows = buildBrandRows(
    [
      base,
      { ...base, id: "DEAL-2", brand_name: "Kopi Nusantara", shop_id: "999", shop_key: "kopi", bizdev_label: "Alya", status: "hold", campaign_ops_id: "u-ops", exp_date: "2026-10-25", gmv_tap: null },
      { ...base, id: "DEAL-3", brand_name: "Aroma", shop_id: "123", shop_key: "aroma", exp_date: "2026-01-01", priority: "P0" },
    ],
    ctx()
  );

  it("filter cari nama/Shop ID, BizDev, Non BD, status, Campaign Ops", () => {
    expect(filterBrandRows(rows, { q: "kopi" }).map((r) => r.id)).toEqual(["DEAL-2"]);
    expect(filterBrandRows(rows, { q: "7495" }).map((r) => r.id)).toEqual(["DEAL-1"]);
    expect(filterBrandRows(rows, { bizdev: "Alya" }).map((r) => r.id)).toEqual(["DEAL-2"]);
    expect(filterBrandRows(rows, { bizdev: NON_BD_FILTER }).map((r) => r.id)).toEqual(["DEAL-1", "DEAL-3"]);
    expect(filterBrandRows(rows, { status: "hold" }).map((r) => r.id)).toEqual(["DEAL-2"]);
    expect(filterBrandRows(rows, { ops: "u-ops" }).map((r) => r.id)).toEqual(["DEAL-2"]);
    expect(filterBrandRows(rows, { ops: NON_OPS_FILTER })).toHaveLength(2);
  });

  it("urut: paling dekat kadaluarsa dulu, yang sudah lewat di belakang", () => {
    expect(sortBrandRows(rows).map((r) => r.id)).toEqual(["DEAL-2", "DEAL-1", "DEAL-3"]);
  });

  it("paginasi menjepit halaman & ukuran tak dikenal", () => {
    const many = Array.from({ length: 23 }, (_, i) => i);
    expect(paginate(many, 3, 10)).toMatchObject({ rows: [20, 21, 22], page: 3, pageCount: 3, from: 21, to: 23, total: 23 });
    expect(paginate(many, 99, 7)).toMatchObject({ page: 3, pageSize: 10 });
    expect(paginate([], 1, 10)).toMatchObject({ from: 0, to: 0, pageCount: 1 });
  });

  it("pilihan filter dari baris aktif", () => {
    const o = brandFilterOptions(rows);
    expect(o.bizdev).toEqual(["Alya"]);
    expect(o.priorities).toEqual(["P0", "P1"]);
    expect(o.campaignOps).toEqual([{ id: "u-ops", name: "Diena Shofwah" }]);
  });
});

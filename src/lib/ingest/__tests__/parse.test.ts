import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseMcnFile, parseTapFile, derivePeriod } from "../parse";
import { parsePercent } from "../schema";

function xlsxFile(rows: Record<string, unknown>[], name = "data.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** CSV (`;`-delimited) File, mirroring the real Indonesian-language platform export. */
function csvFile(text: string, name = "data.csv"): File {
  return new File([text], name, { type: "text/csv" });
}

const MCN_SUMMARY_ROW = {
  Date: "Summary", "Comparison date": "--", "Creator username": "-", "Product ID": "-",
  "Product info": "-", "Shop ID": "-", "Shop name": "-", "Level 1 category": "-",
  "Level 2 category": "-", "Affiliate GMV": "Rp24.749.933.352", "Affiliate LIVE GMV": "Rp17.704.362.998",
  "Affiliate video GMV": "Rp7.023.100.237", "Affiliate orders": "94627", "Affiliate LIVE orders": "12175",
  "Affiliate video orders": "82276", "Direct GMV": "Rp23.412.730.904", "Items sold": "98693",
  "Direct refund GMV": "Rp0", CTR: "--", CTOR: "--",
};

const MCN_DATA_ROW = {
  Date: "2026-06-28-2026-07-04", "Comparison date": "--", "Creator username": "toko_makmur58",
  "Product ID": "1729753671218136555", "Product info": "Kopi Kapal Api", "Shop ID": "7495836523204282859",
  "Shop name": "Kerajaan Sembako", "Level 1 category": "Food & Beverages", "Level 2 category": "Drinks",
  "Affiliate GMV": "Rp5.835.187.681", "Affiliate LIVE GMV": "Rp5.831.117.381", "Affiliate video GMV": "Rp0",
  "Affiliate orders": "2670", "Affiliate LIVE orders": "2669", "Affiliate video orders": "0",
  "Direct GMV": "Rp5.763.617.039", "Items sold": "2683", "Direct refund GMV": "Rp36.890.356",
  CTR: "13.19%", CTOR: "1.93%",
};

// TAP headers carry TRAILING SPACES per production export (task spec §4) — exercised verbatim.
const TAP_DATA_ROW = {
  Date: "2026-06-28-2026-07-04", "Comparison date": "--", "Creator name": "toko_makmur58",
  "Product ID": "1735822345765356850", "Product name": "Minyak Goreng", "Shop ID": "7494649527781919026",
  "Shop name": "KedaiMart", "Level 1 category": "Food & Beverages", "Level 2 category": "Staples & Cooking Essentials",
  "Affiliate GMV": "Rp504.269.544", "Affiliate video GMV": "Rp0", "Affiliate LIVE GMV": "Rp504.269.544",
  Orders: "285", "Items sold": "287",
  "Estimated affiliate partner commission ": "Rp0",
  "Actual affiliate partner commission": "Rp0",
  "Estimated creator commission ": "Rp4.038.376",
  "Actual creator commission ": "Rp724.776",
  "GMV (refund)": "Rp6.874.604",
};

describe("parseMcnFile", () => {
  it("skips the leading Summary row", async () => {
    const file = xlsxFile([MCN_SUMMARY_ROW, MCN_DATA_ROW]);
    const { rows } = await parseMcnFile(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe("1729753671218136555");
  });

  it("parses Rupiah (dot-thousands) and percent columns correctly", async () => {
    const file = xlsxFile([MCN_DATA_ROW]);
    const { rows } = await parseMcnFile(file);
    const [row] = rows;
    expect(row.affiliateGmv).toBe(5_835_187_681);
    expect(row.affiliateLiveGmv).toBe(5_831_117_381);
    expect(row.itemsSold).toBe(2683);
    expect(row.ctr).toBeCloseTo(13.19);
    expect(row.ctor).toBeCloseTo(1.93);
    expect(row.creatorName).toBe("toko_makmur58");
    expect(row.periodStart).toBe("2026-06-28");
    expect(row.periodEnd).toBe("2026-07-04");
  });

  it("does not skip items_sold=0 rows — gmv still counted", async () => {
    const zeroItemsRow = { ...MCN_DATA_ROW, "Product ID": "P-zero", "Items sold": "0", "Affiliate GMV": "Rp100.000" };
    const file = xlsxFile([zeroItemsRow]);
    const { rows, skipped } = await parseMcnFile(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemsSold).toBe(0);
    expect(rows[0].affiliateGmv).toBe(100_000);
    expect(skipped).toEqual([]);
  });

  it("skips rows with missing product/shop id", async () => {
    const badRow = { ...MCN_DATA_ROW, "Product ID": "" };
    const file = xlsxFile([badRow]);
    const { rows, skipped } = await parseMcnFile(file);
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });
});

describe("parseTapFile", () => {
  it("maps TAP headers with trailing spaces correctly", async () => {
    const file = xlsxFile([TAP_DATA_ROW]);
    const { rows } = await parseTapFile(file);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.estPartnerCommission).toBe(0);
    expect(row.estCreatorCommission).toBe(4_038_376);
    expect(row.actualCreatorCommission).toBe(724_776);
    expect(row.affiliateGmv).toBe(504_269_544);
    expect(row.creatorName).toBe("toko_makmur58");
  });
});

describe("derivePeriod", () => {
  it("returns min(periodStart) and max(periodEnd) across rows", async () => {
    const file = xlsxFile([
      { ...MCN_DATA_ROW, "Product ID": "P1", Date: "2026-06-01-2026-06-07" },
      { ...MCN_DATA_ROW, "Product ID": "P2", Date: "2026-06-08-2026-06-14" },
    ]);
    const { rows } = await parseMcnFile(file);
    const period = derivePeriod(rows);
    expect(period).toEqual({ periodStart: "2026-06-01", periodEnd: "2026-06-14" });
  });

  it("returns null when no row has a parseable date", async () => {
    expect(derivePeriod([])).toBeNull();
  });
});

describe("parsePercent", () => {
  it("parses percentage strings to numbers", () => {
    expect(parsePercent("5.45%")).toBeCloseTo(5.45);
    expect(parsePercent("13.19%")).toBeCloseTo(13.19);
  });
  it("returns null for empty/placeholder values", () => {
    expect(parsePercent("--")).toBeNull();
    expect(parsePercent("")).toBeNull();
    expect(parsePercent(null)).toBeNull();
  });
});

// ─── Bahasa Indonesia platform export headers (QA e2e bug, real files under public/qa/) ───
// TikTok Shop export language depends on account setting; the Indonesian export has the
// SAME columns, only the header text differs. Delimiter `;`, "Ringkasan" summary row,
// dot-thousands Rupiah ("Rp435.212.212") — exercised verbatim against a small fixture
// mirroring public/qa/qa-mcn-w4.csv / qa-tap-w4.csv.
const MCN_ID_HEADER =
  "Tanggal;Tanggal perbandingan;Nama pengguna kreator;ID Produk;Info produk;ID Toko;Nama toko;" +
  "Kategori level 1;Kategori level 2;GMV Afiliasi;GMV LIVE Afiliasi;GMV video Afiliasi;" +
  "Pesanan dari Afiliasi;Pesanan dari LIVE Afiliasi;Pesanan dari video Afiliasi;GMV Langsung;" +
  "Produk terjual;GMV pengembalian dana langsung;CTR;CTOR";

const MCN_ID_SUMMARY_ROW =
  "Ringkasan;--;-;-;-;-;-;-;-;Rp2.411.927.669;Rp2.318.296.428;Rp72.660.560;14739;14225;443;" +
  "Rp2.289.539.278;15213;Rp76.623.690;5.90%;5.28%";

const MCN_ID_DATA_ROW =
  "2026-06-22-2026-06-28;--;vikahere;1731304015166407751;Bundling Skincare Bayi & Anak;" +
  "7494840462703167559;MOELL OFFICIAL;Baby & Maternity;Baby Care & Health;Rp435.212.212;" +
  "Rp435.212.212;Rp0;2849;2849;0;Rp431.717.268;2891;Rp7.925.667;8.77%;6.34%";

const TAP_ID_HEADER =
  "Tanggal;Tanggal perbandingan;ID Campaign;Nama campaign;Durasi campaign;ID Produk;Nama produk;" +
  "ID Toko;Nama toko;Kategori level 1;Kategori level 2;GMV Afiliasi;GMV video Afiliasi;" +
  "GMV LIVE Afiliasi;Pesanan;Perkiraan komisi affiliate partner;Komisi aktual untuk affiliate partner;" +
  "Perkiraan komisi kreator;Komisi aktual untuk kreator;GMV (pengembalian dana);Produk terjual";

const TAP_ID_SUMMARY_ROW =
  "Ringkasan;--;-;-;-;-;-;-;-;-;-;Rp1.876.117.880;Rp2.827.108;Rp1.871.680.960;11477;" +
  "Rp100.711;Rp66.803;Rp108.422.075;Rp112.906.229;Rp61.985.965;11809";

const TAP_ID_DATA_ROW =
  "2026-06-22-2026-06-28;--;7578644933704664853;vikahere X Brand;2025-12-01-2026-11-25;" +
  "1731304015166407751;Bundling Skincare Bayi & Anak;7494840462703167559;MOELL OFFICIAL;" +
  "Baby & Maternity;Baby Care & Health;Rp435.212.213;Rp0;Rp435.212.213;2849;" +
  "Rp0;Rp0;Rp11.937.812;Rp5.349.539;Rp7.925.667;2891";

describe("parseMcnFile — header Indonesia (QA e2e bug)", () => {
  it("translates Indonesian headers and skips the Ringkasan row", async () => {
    const file = csvFile([MCN_ID_HEADER, MCN_ID_SUMMARY_ROW, MCN_ID_DATA_ROW].join("\n"));
    const { rows, skipped } = await parseMcnFile(file);
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([]);

    const [row] = rows;
    expect(row.productId).toBe("1731304015166407751");
    expect(row.shopId).toBe("7494840462703167559");
    expect(row.shopName).toBe("MOELL OFFICIAL");
    expect(row.creatorName).toBe("vikahere");
    expect(row.level1Category).toBe("Baby & Maternity");
    expect(row.level2Category).toBe("Baby Care & Health");
    expect(row.affiliateGmv).toBe(435_212_212); // dot-thousands Rupiah
    expect(row.affiliateLiveGmv).toBe(435_212_212);
    expect(row.affiliateVideoGmv).toBe(0);
    expect(row.orders).toBe(2849);
    expect(row.itemsSold).toBe(2891);
    expect(row.periodStart).toBe("2026-06-22");
    expect(row.periodEnd).toBe("2026-06-28");
    expect(row.ctr).toBeCloseTo(8.77);
    expect(row.ctor).toBeCloseTo(6.34);
  });
});

describe("parseTapFile — header Indonesia (QA e2e bug)", () => {
  it("translates Indonesian headers; no creator column in this variant", async () => {
    const file = csvFile([TAP_ID_HEADER, TAP_ID_SUMMARY_ROW, TAP_ID_DATA_ROW].join("\n"));
    const { rows, skipped } = await parseTapFile(file);
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([]);

    const [row] = rows;
    expect(row.productId).toBe("1731304015166407751");
    expect(row.shopId).toBe("7494840462703167559");
    expect(row.shopName).toBe("MOELL OFFICIAL");
    expect(row.creatorName).toBe(""); // ID 1-creator TAP export has no creator column at all
    expect(row.affiliateGmv).toBe(435_212_213);
    expect(row.affiliateVideoGmv).toBe(0);
    expect(row.affiliateLiveGmv).toBe(435_212_213);
    expect(row.orders).toBe(2849);
    expect(row.itemsSold).toBe(2891);
    expect(row.estPartnerCommission).toBe(0);
    expect(row.actualPartnerCommission).toBe(0);
    expect(row.estCreatorCommission).toBe(11_937_812);
    expect(row.actualCreatorCommission).toBe(5_349_539);
    expect(row.refundGmv).toBe(7_925_667);
    expect(row.periodStart).toBe("2026-06-22");
    expect(row.periodEnd).toBe("2026-06-28");
  });
});

describe("English header path unaffected by ID alias translation", () => {
  it("parseMcnFile still parses pure-English headers correctly", async () => {
    const file = xlsxFile([MCN_DATA_ROW]);
    const { rows } = await parseMcnFile(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].affiliateGmv).toBe(5_835_187_681);
    expect(rows[0].creatorName).toBe("toko_makmur58");
  });

  it("parseTapFile still parses pure-English (trailing-space) headers correctly", async () => {
    const file = xlsxFile([TAP_DATA_ROW]);
    const { rows } = await parseTapFile(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].estCreatorCommission).toBe(4_038_376);
    expect(rows[0].creatorName).toBe("toko_makmur58");
  });
});

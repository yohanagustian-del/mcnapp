import { describe, expect, it } from "vitest";
import { parseShopeeFile, validateSingleShopeeWindow } from "../shopee-csv";

/** CSV File builder, mirroring parse.test.ts's csvFile helper. */
function csvFile(text: string, name = "conversion_report.csv"): File {
  return new File([text], name, { type: "text/csv" });
}

const HEADER =
  "ID Pesanan,Status Pesanan,ID Pesanan Affiliate,Waktu Pesanan Dibuat,Waktu Pesanan Selesai,Waktu Klik," +
  "Nama Affiliate,Username Affiliate,ID Kontrak MCN,Nama Toko,ID Toko,Jenis Toko,ID Produk,Nama Produk," +
  "ID Variasi Produk,Tipe Produk,ID Promosi,Kategori L1,Kategori L2,Kategori L3,Qty,Harga(Rp),Campaign Type," +
  "Partner Promo,ID Komisi Pesanan,Total Pembelian yang Dibuat(Rp),Jumlah Pengembalian(Rp),Status Pesanan Affiliate," +
  "Catatan Produk,Tipe Pesanan,Status Pembeli,Tag_link1,Tag_link2,Tag_link3,Tag_link4,Tag_link5,Platform";

/** Minimal row matching the real Shopee Conversion Report column count/order (only the columns this parser reads carry meaningful values). */
function row(opts: {
  status?: string;
  orderedAt?: string;
  completedAt?: string;
  affiliateName?: string;
  username?: string;
  productId?: string;
  productName?: string;
  shopId?: string;
  shopName?: string;
  cat1?: string;
  cat2?: string;
  gmv?: string;
  platform?: string;
}): string {
  const {
    status = "Selesai", orderedAt = "2026-07-03 11:00:00", completedAt = "2026-07-03 12:00:00", affiliateName = "Nama Affiliate",
    username = "affuser", productId = "111", productName = "Produk A", shopId = "999",
    shopName = "Toko A", cat1 = "Cat1", cat2 = "Cat2", gmv = "100000", platform = "Shopeelive-Shopee",
  } = opts;
  return [
    "ORDER1", status, "AFF1", orderedAt, completedAt, "2026-07-03 10:00:00",
    affiliateName, username, "1082254", shopName, shopId, "Shopee Mall", productId, productName,
    "VAR1", "Produk", "", cat1, cat2, "SubCat", "1", "50000", "Promo MCN", "Pemilik", "COMM1",
    gmv, "0", "Selesai", "", "Pesanan Langsung", "Baru", "", "", "", "", "", platform,
  ].join(",");
}

function buildCsv(rows: string[]): string {
  return "﻿" + [HEADER, ...rows].join("\n"); // BOM utf-8-sig, like the real export
}

describe("parseShopeeFile", () => {
  it("parses BOM-prefixed CSV and keeps only Selesai rows", async () => {
    const csv = buildCsv([
      row({ status: "Selesai" }),
      row({ status: "Pembatalan" }),
      row({ status: "Sedang Diproses" }),
    ]);
    const { rows, rowsNonCompleted, rawHeadersFound } = await parseShopeeFile(csvFile(csv));
    expect(rows).toHaveLength(1);
    expect(rowsNonCompleted).toBe(2);
    expect(rawHeadersFound.length).toBeGreaterThan(0);
  });

  it("splits GMV into live/video/other buckets by Platform column", async () => {
    const csv = buildCsv([
      row({ platform: "Shopeelive-Shopee", gmv: "100000" }),
      row({ platform: "Shopeevideo-Shopee", gmv: "50000" }),
      row({ platform: "WhatsApp", gmv: "10000" }),
    ]);
    const { rows } = await parseShopeeFile(csvFile(csv));
    expect(rows).toHaveLength(3);
    expect(rows[0].bucket).toBe("live");
    expect(rows[1].bucket).toBe("video");
    expect(rows[2].bucket).toBe("other");
  });

  it("parses GMV as a plain number (tolerant parser)", async () => {
    const csv = buildCsv([row({ gmv: "119200" })]);
    const { rows } = await parseShopeeFile(csvFile(csv));
    expect(rows[0].gmv).toBe(119200);
  });

  it("takes only the date part of Waktu Pesanan Dibuat", async () => {
    const csv = buildCsv([row({ orderedAt: "2026-07-03 23:59:59" })]);
    const { rows } = await parseShopeeFile(csvFile(csv));
    expect(rows[0].orderDate).toBe("2026-07-03");
  });

  it("keys the window on Waktu Pesanan Dibuat, not Waktu Pesanan Selesai", async () => {
    // Real export filtered by order date 1-7: orders created in W1 complete days/weeks later.
    const csv = buildCsv([
      row({ orderedAt: "2026-09-01 08:00:00", completedAt: "2026-09-02 10:00:00" }),
      row({ orderedAt: "2026-09-07 23:59:58", completedAt: "2026-09-13 17:33:41" }),
      row({ orderedAt: "2026-09-05 12:00:00", completedAt: "2026-09-30 09:00:00" }),
    ]);
    const { rows } = await parseShopeeFile(csvFile(csv));
    expect(rows.map((r) => r.orderDate)).toEqual(["2026-09-01", "2026-09-07", "2026-09-05"]);
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(true);
    expect(result.periodStart).toBe("2026-09-01");
    expect(result.periodEnd).toBe("2026-09-07");
  });

  it("streams a large file intact: every row, multi-byte names across chunk boundaries", async () => {
    // ~5MB: far past Node's 64KB stream chunks, so rows and UTF-8 chars get split mid-chunk.
    const name = "Kalung Liontin — Émile ✓ 日本 ".repeat(8).trim();
    const lines = Array.from({ length: 20_000 }, (_, i) =>
      row({ productId: String(1000 + i), productName: name, gmv: "Rp1.000" })
    );
    const { rows, skipped } = await parseShopeeFile(csvFile(buildCsv(lines)));
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(20_000);
    expect(rows.every((r) => r.productName === name)).toBe(true);
    expect(rows[19_999].productId).toBe("20999");
    expect(rows.reduce((a, r) => a + r.gmv, 0)).toBe(20_000_000);
  });

  it("reports unrecognized headers with the file's first line instead of silently returning nothing", async () => {
    const { rows, skipped, rawHeadersFound, headerNotFound } = await parseShopeeFile(
      csvFile("Order ID,Order Status\n1,Completed\n")
    );
    expect(rows).toHaveLength(0);
    expect(rawHeadersFound).toEqual([]);
    expect(skipped[0].reason).toMatch(/Header wajib tidak ditemukan/);
    expect(headerNotFound).toEqual({ firstLine: "Order ID,Order Status" });
  });

  it("skips title/preamble lines above the header (same allowance as parseSheet)", async () => {
    const csv = "\uFEFFLaporan Konversi Affiliate,,\nPeriode 2026-07-01 - 2026-07-07\n" + [HEADER, row({})].join("\n");
    const { rows, headerNotFound } = await parseShopeeFile(csvFile(csv));
    expect(headerNotFound).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0].affiliateUsername).toBe("affuser");
  });

  it("decodes a UTF-16 file (Excel 'Unicode Text' re-save) by its BOM", async () => {
    const text = [HEADER, row({ productName: "Kalung — Émile ✓" })].join("\n");
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      le[2 + 2 * i] = c & 0xff;
      le[3 + 2 * i] = c >> 8;
    }
    const { rows } = await parseShopeeFile(new File([le], "export.csv", { type: "text/csv" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].productName).toBe("Kalung — Émile ✓");
  });

  it("skips rows with missing product/shop id even when Selesai", async () => {
    const csv = buildCsv([row({ productId: "" })]);
    const { rows, skipped } = await parseShopeeFile(csvFile(csv));
    expect(rows).toHaveLength(0);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it("skips the Summary/Ringkasan totals row", async () => {
    const csv = buildCsv([row({ status: "Summary" }), row({ status: "Selesai" })]);
    const { rows, rowsNonCompleted } = await parseShopeeFile(csvFile(csv));
    expect(rows).toHaveLength(1);
    expect(rowsNonCompleted).toBe(0); // Summary row doesn't count as non-completed either
  });

  it("falls back Nama Affiliate to username when name is blank", async () => {
    const csv = buildCsv([row({ affiliateName: "", username: "onlyusername" })]);
    const { rows } = await parseShopeeFile(csvFile(csv));
    expect(rows[0].affiliateName).toBe("onlyusername");
  });
});

describe("validateSingleShopeeWindow", () => {
  it("accepts all Selesai rows within one W1-W5 window (happy path)", () => {
    const rows = [
      { orderDate: "2026-07-01" }, { orderDate: "2026-07-04" }, { orderDate: "2026-07-07" },
    ] as Parameters<typeof validateSingleShopeeWindow>[0];
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(true);
    expect(result.periodStart).toBe("2026-07-01");
    expect(result.periodEnd).toBe("2026-07-07");
  });

  it("rejects when Selesai rows cross two windows within the same month", () => {
    const rows = [
      { orderDate: "2026-07-07" }, // W1
      { orderDate: "2026-07-08" }, // W2
    ] as Parameters<typeof validateSingleShopeeWindow>[0];
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/lebih dari satu window/);
  });

  it("rejects when Selesai rows cross a month boundary (real sample file scenario: 28 Jun-4 Jul)", () => {
    const rows = [
      { orderDate: "2026-06-29" }, // June W5
      { orderDate: "2026-07-04" }, // July W1
    ] as Parameters<typeof validateSingleShopeeWindow>[0];
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/lebih dari satu window/);
    expect(result.reason).toMatch(/2026-06-29 s\/d 2026-07-04/);
  });

  it("rejects an empty row set", () => {
    const result = validateSingleShopeeWindow([]);
    expect(result.valid).toBe(false);
  });

  it("returns window boundaries, not the min/max actual dates found", () => {
    // Actual dates only span 2-4 July but the WINDOW (W1) is 1-7.
    const rows = [
      { orderDate: "2026-07-02" }, { orderDate: "2026-07-04" },
    ] as Parameters<typeof validateSingleShopeeWindow>[0];
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(true);
    expect(result.periodStart).toBe("2026-07-01");
    expect(result.periodEnd).toBe("2026-07-07");
  });
});

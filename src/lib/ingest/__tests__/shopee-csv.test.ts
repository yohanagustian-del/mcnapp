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
    status = "Selesai", completedAt = "2026-07-03 12:00:00", affiliateName = "Nama Affiliate",
    username = "affuser", productId = "111", productName = "Produk A", shopId = "999",
    shopName = "Toko A", cat1 = "Cat1", cat2 = "Cat2", gmv = "100000", platform = "Shopeelive-Shopee",
  } = opts;
  return [
    "ORDER1", status, "AFF1", "2026-07-03 11:00:00", completedAt, "2026-07-03 10:00:00",
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

  it("takes only the date part of Waktu Pesanan Selesai", async () => {
    const csv = buildCsv([row({ completedAt: "2026-07-03 23:59:59" })]);
    const { rows } = await parseShopeeFile(csvFile(csv));
    expect(rows[0].completedDate).toBe("2026-07-03");
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
      { completedDate: "2026-07-01" }, { completedDate: "2026-07-04" }, { completedDate: "2026-07-07" },
    ] as Parameters<typeof validateSingleShopeeWindow>[0];
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(true);
    expect(result.periodStart).toBe("2026-07-01");
    expect(result.periodEnd).toBe("2026-07-07");
  });

  it("rejects when Selesai rows cross two windows within the same month", () => {
    const rows = [
      { completedDate: "2026-07-07" }, // W1
      { completedDate: "2026-07-08" }, // W2
    ] as Parameters<typeof validateSingleShopeeWindow>[0];
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/lebih dari satu window/);
  });

  it("rejects when Selesai rows cross a month boundary (real sample file scenario: 28 Jun-4 Jul)", () => {
    const rows = [
      { completedDate: "2026-06-29" }, // June W5
      { completedDate: "2026-07-04" }, // July W1
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
      { completedDate: "2026-07-02" }, { completedDate: "2026-07-04" },
    ] as Parameters<typeof validateSingleShopeeWindow>[0];
    const result = validateSingleShopeeWindow(rows);
    expect(result.valid).toBe(true);
    expect(result.periodStart).toBe("2026-07-01");
    expect(result.periodEnd).toBe("2026-07-07");
  });
});

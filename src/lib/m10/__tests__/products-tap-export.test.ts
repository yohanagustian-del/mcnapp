import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normalizeHeader } from "@/lib/utils/csv";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseCommission } from "@/lib/utils/commission";
import { parseFlexibleDate } from "@/lib/utils/date";
import { parsePriceCell } from "@/lib/m10/products";

/**
 * Kontrak header export TAP "Export link"
 * (Creator Matchmaking → Manage → room campaign → View detail → Approved →
 * Products → Export link). Disalin apa adanya dari file export asli, termasuk
 * "product name" yang huruf kecil, kolom gambar tanpa judul, dan kolom terakhir
 * yang oleh platform ditandai hanya untuk pengecekan.
 */
const EXPORT_HEADERS = [
  "Campaign ID",
  "product name",
  "", // kolom gambar produk — tanpa judul
  "Product ID",
  "Sale price",
  "Shop name",
  "Product effective start time",
  "Product effective end time",
  "Creator commission rate",
  "Affiliate partner commission rate",
  "Creator Shop Ads commission rate",
  "Affiliate partner Shop Ads commission rate",
  "Product link",
  "(Only for checking. Please use the left one.)",
];

/** Satu baris nyata dari export (nilai apa adanya). */
const SAMPLE_ROW = {
  campaignId: "7662920044527912724",
  productName: "[CUIT] Kantong Tidur Bayi Bedong Bayi Selimut Instan Lengan Flexible Neru",
  productId: "1729859716545022432",
  salePrice: "Rp65.000",
  shopName: "CUIT BABYWEAR",
  effectiveStart: "16/07/2026 00:00:00",
  effectiveEnd: "10/07/2027 23:59:59",
  creatorCommission: "7.00%",
  partnerCommission: "1.00%",
  creatorShopAds: "1.75%",
  partnerShopAds: "0.25%",
  productLink: "https://affiliate-id.tokopedia.com/api/v1/share/ALGs628oIVxC",
  checkingLink: "https://shop-id.tokopedia.com/view/product/1729859716545022432?region=ID",
};

/** Alias yang dipakai parser (harus cocok dengan H di src/lib/m10/products.ts). */
const ALIASES = {
  campaignId: "campaign_id",
  productName: "product_name",
  productId: "product_id",
  price: "sale_price",
  shopName: "shop_name",
  effectiveStart: "product_effective_start_time",
  effectiveEnd: "product_effective_end_time",
  commission: "creator_commission_rate",
  partnerCommissionRate: "affiliate_partner_commission_rate",
  creatorShopAdsCommissionRate: "creator_shop_ads_commission_rate",
  partnerShopAdsCommissionRate: "affiliate_partner_shop_ads_commission_rate",
  productLink: "product_link",
};

describe("header export TAP Export link", () => {
  it("setiap kolom yang dipakai ternormalisasi ke alias parser", () => {
    const normalized = EXPORT_HEADERS.map(normalizeHeader);

    for (const alias of Object.values(ALIASES)) {
      expect(normalized, `alias "${alias}" tidak ada di header export`).toContain(alias);
    }
  });

  it('kolom "only for checking" TIDAK bertabrakan dengan product_link', () => {
    // Platform menandai kolom terakhir sebagai pembanding saja. Kalau suatu saat
    // ia ikut ternormalisasi jadi product_link, link afiliasi yang benar akan
    // tertimpa URL toko — jadi pemisahannya dikunci di sini.
    const decoy = normalizeHeader("(Only for checking. Please use the left one.)");
    expect(decoy).not.toBe(ALIASES.productLink);
    expect(normalizeHeader("Product link")).toBe(ALIASES.productLink);
  });

  it("kolom gambar tanpa judul tidak menabrak kolom lain", () => {
    const blank = normalizeHeader("");
    expect(Object.values(ALIASES)).not.toContain(blank);
  });

  it("header terbaca lewat XLSX seperti file aslinya", () => {
    // sheet_to_json memberi nama sintetis untuk kolom tanpa judul; yang penting
    // kolom-kolom bernama tetap terpetakan.
    const ws = XLSX.utils.aoa_to_sheet([
      EXPORT_HEADERS,
      [
        SAMPLE_ROW.campaignId, SAMPLE_ROW.productName, "", SAMPLE_ROW.productId,
        SAMPLE_ROW.salePrice, SAMPLE_ROW.shopName, SAMPLE_ROW.effectiveStart,
        SAMPLE_ROW.effectiveEnd, SAMPLE_ROW.creatorCommission, SAMPLE_ROW.partnerCommission,
        SAMPLE_ROW.creatorShopAds, SAMPLE_ROW.partnerShopAds, SAMPLE_ROW.productLink,
        SAMPLE_ROW.checkingLink,
      ],
    ]);
    const [row] = XLSX.utils
      .sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: "" })
      .map((r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) out[normalizeHeader(k)] = String(v ?? "").trim();
        return out;
      });

    expect(row[ALIASES.campaignId]).toBe(SAMPLE_ROW.campaignId);
    expect(row[ALIASES.productId]).toBe(SAMPLE_ROW.productId);
    expect(row[ALIASES.shopName]).toBe(SAMPLE_ROW.shopName);
    expect(row[ALIASES.productLink]).toBe(SAMPLE_ROW.productLink);
  });
});

describe("nilai sel export TAP", () => {
  it('harga "Rp65.000" dibaca 65.000 (titik = ribuan)', () => {
    expect(parseRupiah(SAMPLE_ROW.salePrice)).toBe(65_000);
    expect(parsePriceCell(SAMPLE_ROW.salePrice)).toBe(65_000);
    expect(parsePriceCell("Rp46.000")).toBe(46_000);
    expect(parsePriceCell("Rp52.500")).toBe(52_500);
  });

  it("empat rate komisi terbaca sebagai persen", () => {
    expect(parseCommission(SAMPLE_ROW.creatorCommission)?.min).toBe(7);
    expect(parseCommission(SAMPLE_ROW.partnerCommission)?.min).toBe(1);
    expect(parseCommission(SAMPLE_ROW.creatorShopAds)?.min).toBe(1.75);
    expect(parseCommission(SAMPLE_ROW.partnerShopAds)?.min).toBe(0.25);
  });

  it("masa berlaku DD/MM/YYYY + jam terbaca sebagai tanggal", () => {
    const dayPart = (v: string) => parseFlexibleDate(v.split(/\s+/)[0] ?? "");
    expect(dayPart(SAMPLE_ROW.effectiveStart)).toBe("2026-07-16");
    expect(dayPart(SAMPLE_ROW.effectiveEnd)).toBe("2027-07-10");
  });
});

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { parseSheet } from "@/lib/utils/sheet";
import { brandLeadSearchPatterns, escapeLike } from "../brand-lead";
import {
  BRAND_LEAD_HEADER_PROBE,
  BRAND_LEAD_UPLOAD_COLUMNS,
  brandLeadKey,
  buildBrandLeadUploadRows,
  isEmptyMerge,
  mergeBrandLead,
  parseContactCell,
  type BrandLeadSnapshot,
} from "../bulk-upload-spec";
import { BRAND_LEAD_TEMPLATE_FILENAME, BRAND_LEAD_TEMPLATE_SHEET, buildBrandLeadTemplate } from "../bulk-upload-template";

describe("parseContactCell — bentuk sel di spreadsheet matchmaking", () => {
  it("nama - nomor tanpa 0 di depan", () => {
    expect(parseContactCell("Erlia -  822-9868-4200").contacts).toEqual([{ lead_name: "Erlia", phone: "+6282298684200" }]);
  });
  it("nama +62 berspasi", () => {
    expect(parseContactCell("Kayla +62 851-1123-6551").contacts).toEqual([{ lead_name: "Kayla", phone: "+6285111236551" }]);
  });
  it("nama 62 berspasi", () => {
    expect(parseContactCell("Ulinuhasorya 62 878-1628-2268").contacts).toEqual([
      { lead_name: "Ulinuhasorya", phone: "+6287816282268" },
    ]);
  });
  it("nama dan nomor beda baris", () => {
    expect(parseContactCell("Joshua\n0811-8720-132").contacts).toEqual([{ lead_name: "Joshua", phone: "+628118720132" }]);
  });
  it("dua kontak, nama di depan", () => {
    expect(parseContactCell("milfan :  888-0955-5993\nnurul : 878-7356-7327").contacts).toEqual([
      { lead_name: "milfan", phone: "+6288809555993" },
      { lead_name: "nurul", phone: "+6287873567327" },
    ]);
  });
  it("dua kontak, nama di belakang dalam kurung", () => {
    expect(parseContactCell("6287839892632 (Ganar)\n6281211541302 (Awang)").contacts).toEqual([
      { lead_name: "Ganar", phone: "+6287839892632" },
      { lead_name: "Awang", phone: "+6281211541302" },
    ]);
  });
  it("nomor saja", () => {
    expect(parseContactCell("62 812-9024-0083").contacts).toEqual([{ phone: "+6281290240083" }]);
    expect(parseContactCell("81111806861").contacts).toEqual([{ phone: "+6281111806861" }]);
  });
  it("nama + link Lark tanpa nomor → link dipisah untuk Catatan", () => {
    const r = parseContactCell("jessica / san https://applink.larksuite.com/client/chat/chatter/add_by_link?link_token=1d5kea9f-442c");
    expect(r.contacts).toEqual([{ lead_name: "jessica / san" }]);
    expect(r.links).toEqual(["https://applink.larksuite.com/client/chat/chatter/add_by_link?link_token=1d5kea9f-442c"]);
  });
  it("nomor + email tanpa pemisah nama = satu kontak", () => {
    expect(parseContactCell("Budi 0812-3456-7890 budi@brand.co.id").contacts).toEqual([
      { lead_name: "Budi", phone: "+6281234567890", email: "budi@brand.co.id" },
    ]);
  });
  it("awalan @ dibuang, nama sesudah nomor terbaca", () => {
    expect(parseContactCell("@+62 815-6802-352,").contacts).toEqual([{ phone: "+628156802352" }]);
    expect(parseContactCell("62 813-1524-3676 abi").contacts).toEqual([{ lead_name: "abi", phone: "+6281315243676" }]);
  });
  it("nomor Tiongkok 86… tidak dipaksa +62", () => {
    expect(parseContactCell("Coby 86 191 2055 6687").contacts).toEqual([{ lead_name: "Coby", phone: "+8619120556687" }]);
  });
  it("sel kosong → tanpa kontak", () => {
    expect(parseContactCell("   ").contacts).toEqual([]);
  });
});

describe("brandLeadKey", () => {
  it("abaikan huruf besar/kecil, spasi & tanda baca", () => {
    expect(brandLeadKey("GRENEY.Underwear.id")).toBe(brandLeadKey(" greney underwear ID "));
    expect(brandLeadKey("DiliDili.Shop")).toBe("dilidilishop");
  });
  it("nama tanpa huruf/angka → null", () => {
    expect(brandLeadKey(" - ")).toBeNull();
    expect(brandLeadKey(undefined)).toBeNull();
  });
  it("huruf non-latin tetap jadi bagian kunci", () => {
    expect(brandLeadKey("amei アメイ")).toBe("ameiアメイ");
  });
});

/** The matchmaking sheet as Google Sheets exports it: a "Bizdev" super-header row above the header. */
function matchmakingCsv(rows: string[][]): File {
  const header = [
    "Nama Brand (WAJIB SESUAI DISPLAY PLATFORM)", "Bizdev", "NIche", "Link Toko Seller / Brand",
    "Contact PIC Brand", "Grup Brand", "Sample, Flash Sale & Ads", "Ads Brand",
  ];
  const csv = Papa.unparse([header.map(() => "Bizdev"), header, ...rows]);
  return new File([csv], "Data Contoh Matchmaking - Sheet1.csv", { type: "text/csv" });
}

describe("upload spreadsheet matchmaking", () => {
  it("baris super-header dilewati, kolom terpetakan, baris brand ganda digabung", async () => {
    const file = matchmakingCsv([
      ["DVARA", "Alya", "Beauty & Personal Care", "", "Ulinuhasorya 62 878-1628-2268",
        "https://chat.whatsapp.com/Ic8Bu3UW2zN1yergITRWBG", "Sample, Flash Sale, Ads", "Ads By Brand - Minta Barcode"],
      ["DiliDili.Shop", "Erlina, Mizan", "Food & Beverages", "", "62 878-4798-2052",
        "Conley shop X MEA -Toko Makmur", "Sample, Ads", "Brand Invoice One Time - Cek BD"],
      ["DiliDili.Shop", "Erlina, Mizan", "Food & Beverages", "", "62 823-1591-5053",
        "Conley shop X MEA -Toko Makmur", "Sample, Ads", "Brand Invoice One Time - Cek BD"],
      ["", "Laila", "Fashion", "", "", "", "Sample", ""],
      ["", "", "", "", "", "", "", ""],
    ]);
    const { rows, errors, skippedRows } = await parseSheet(file, BRAND_LEAD_HEADER_PROBE);
    expect(errors).toEqual([]);
    expect(skippedRows).toBe(1);

    const parsed = buildBrandLeadUploadRows(rows, "matchmaking", (skippedRows ?? 0) + 1);
    expect(parsed).toHaveLength(3);

    const [dvara, dili, empty] = parsed;
    expect(dvara.rowNumbers).toEqual([3]);
    expect(dvara.lead).toMatchObject({
      source: "matchmaking",
      status: "baru",
      shop_name: "DVARA",
      bizdev_names: "Alya",
      business_category: "Beauty & Personal Care",
      brand_group: "https://chat.whatsapp.com/Ic8Bu3UW2zN1yergITRWBG",
      brand_support: ["sample", "flash_sale", "ads_support"],
      ads_scheme: "Ads By Brand - Minta Barcode",
      contacts: [{ lead_name: "Ulinuhasorya", phone: "+6287816282268" }],
    });
    expect(dvara.lead?.store_link).toBeUndefined();

    expect(dili.rowNumbers).toEqual([4, 5]);
    expect(dili.lead?.contacts).toEqual([{ phone: "+6287847982052" }, { phone: "+6282315915053" }]);

    expect(empty.error).toMatch(/Nama Brand dan Contact PIC kosong/);
  });

  it("dukungan/platform tak dikenal masuk Catatan + catatan baris, bukan hilang", async () => {
    const parsed = buildBrandLeadUploadRows(
      [{ nama_brand: "Toko X", "sample,_flash_sale_&_ads": "Sample, Live Host", platform: "TikTok Shop, Lazada" }],
      "event"
    );
    expect(parsed[0].lead).toMatchObject({ brand_support: ["sample"], platforms: ["tiktok_shop"] });
    expect(parsed[0].lead?.notes).toContain("Dukungan lain: Live Host");
    expect(parsed[0].lead?.notes).toContain("Platform lain: Lazada");
    expect(parsed[0].issues).toHaveLength(2);
  });

  it("file tanpa kolom Nama Brand → error header", async () => {
    const file = new File(["foo,bar\n1,2\n"], "x.csv", { type: "text/csv" });
    const { errors } = await parseSheet(file, BRAND_LEAD_HEADER_PROBE);
    expect(errors[0]).toMatch(/Nama Brand/);
  });
});

describe("mergeBrandLead — hanya menambah, tidak menimpa", () => {
  const existing: BrandLeadSnapshot = {
    shop_name: "Lemonilo",
    business_category: "Food & Beverages",
    bizdev_names: null,
    ads_scheme: "",
    notes: "Catatan lama",
    platforms: ["tiktok_shop"],
    brand_support: ["sample"],
    contacts: [{ lead_name: "Izzah", phone: "+6281288196981" }],
  };

  it("isi kolom kosong, gabung checkbox, tambah kontak baru saja", () => {
    const m = mergeBrandLead(existing, {
      shop_name: "LEMONILO",
      business_category: "FMCG",
      bizdev_names: "Erlina, Fanny",
      ads_scheme: "Brand Invoice Bulking - Cek BD",
      notes: "Catatan lama\nLink kontak PIC: https://x",
      platforms: ["shopee"],
      brand_support: ["sample", "ads_support"],
      contacts: [{ lead_name: "Izzah (baru)", phone: "+6281288196981" }, { lead_name: "Rina", phone: "+6281111111111" }],
    });
    expect(m.patch).toEqual({
      bizdev_names: "Erlina, Fanny",
      ads_scheme: "Brand Invoice Bulking - Cek BD",
      notes: "Catatan lama\nLink kontak PIC: https://x",
      platforms: ["tiktok_shop", "shopee"],
      brand_support: ["sample", "ads_support"],
    });
    expect(m.addContacts).toEqual([{ lead_name: "Rina", phone: "+6281111111111" }]);
  });

  it("upload ulang data yang sama = tidak ada perubahan", () => {
    expect(isEmptyMerge(mergeBrandLead(existing, { ...existing, shop_name: "lemonilo" }))).toBe(true);
  });
});

describe("pencarian", () => {
  it("satu pola per kata, wildcard di-escape", () => {
    expect(brandLeadSearchPatterns("  greney  underwear ")).toEqual(["%greney%", "%underwear%"]);
    expect(brandLeadSearchPatterns("nces_nina 100%")).toEqual(["%nces\\_nina%", "%100\\%%"]);
    expect(brandLeadSearchPatterns("*")).toEqual([]);
    expect(brandLeadSearchPatterns(undefined)).toEqual([]);
  });
  it("escapeLike untuk filter niche persis", () => {
    expect(escapeLike("Baby & Maternity")).toBe("Baby & Maternity");
    expect(escapeLike("a_b")).toBe("a\\_b");
  });
});

describe("template Brand Lead Bank", () => {
  const wb = () => XLSX.read(buildBrandLeadTemplate(), { type: "array" });

  it("header sama persis dengan BRAND_LEAD_UPLOAD_COLUMNS + petunjuk per kolom", () => {
    const w = wb();
    expect(w.SheetNames).toEqual([BRAND_LEAD_TEMPLATE_SHEET, "Petunjuk"]);
    const header = XLSX.utils.sheet_to_json<string[]>(w.Sheets[BRAND_LEAD_TEMPLATE_SHEET], { header: 1 })[0];
    expect(header).toEqual(BRAND_LEAD_UPLOAD_COLUMNS.map((c) => c.label));
    const guide = XLSX.utils.sheet_to_csv(w.Sheets.Petunjuk);
    for (const c of BRAND_LEAD_UPLOAD_COLUMNS) expect(guide).toContain(c.label);
  });

  it("round-trip: template diisi → parseSheet → buildBrandLeadUploadRows terbaca", async () => {
    const w = wb();
    const values: Record<string, string> = {
      shop_name: "Hanasui",
      bizdev_names: "Alya",
      business_category: "Beauty & Personal Care",
      store_link: "https://vt.tiktok.com/abc",
      contacts: "Cika 62 878-5656-7664",
      brand_group: "MEA X HANASUI",
      brand_support: "Sample, Ads, Flash Sale",
      ads_scheme: "Ads By Brand - Minta Barcode",
      city: "Jakarta",
      platforms: "TikTok Shop",
      notes: "dari event Oktober",
    };
    XLSX.utils.sheet_add_aoa(w.Sheets[BRAND_LEAD_TEMPLATE_SHEET], [BRAND_LEAD_UPLOAD_COLUMNS.map((c) => values[c.key])], {
      origin: "A2",
    });
    const buf = XLSX.write(w, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { rows, errors } = await parseSheet(new File([buf], BRAND_LEAD_TEMPLATE_FILENAME), BRAND_LEAD_HEADER_PROBE);
    expect(errors).toEqual([]);
    const parsed = buildBrandLeadUploadRows(rows, "matchmaking");
    expect(parsed).toHaveLength(1);
    expect(parsed[0].error).toBeNull();
    expect(parsed[0].lead).toMatchObject({
      shop_name: "Hanasui",
      bizdev_names: "Alya",
      business_category: "Beauty & Personal Care",
      store_link: "https://vt.tiktok.com/abc",
      brand_group: "MEA X HANASUI",
      brand_support: ["sample", "ads_support", "flash_sale"],
      ads_scheme: "Ads By Brand - Minta Barcode",
      city: "Jakarta",
      platforms: ["tiktok_shop"],
      notes: "dari event Oktober",
      contacts: [{ lead_name: "Cika", phone: "+6287856567664" }],
    });
  });
});

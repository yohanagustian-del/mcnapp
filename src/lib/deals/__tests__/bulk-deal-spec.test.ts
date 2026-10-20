import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  BULK_DEAL_COLUMNS,
  buildBulkDealWorkbook,
  bulkRowToRecord,
  countdownDays,
  outOfListValues,
  parseBizdev,
  parseBulkDealMatrix,
  parseSupportTypes,
  readSheetMatrix,
} from "../bulk-deal-spec";

// Baris nyata dari tab "DATA BULKING! UNTUK KO YOHAN" (2026-10-20); kontak PIC & link
// grup WA dikosongkan.
const csv = readFileSync(join(__dirname, "fixtures/bulk-deal-sample.csv"), "utf8");
const matrix = readSheetMatrix(csv, "bulk.csv");
const res = parseBulkDealMatrix(matrix);
const loaded = (shop: string) => res.rows.filter((r) => r.shopId === shop).map((r) => r.brandName).sort();
const skippedNames = (reason: string) => [...new Set(res.skipped.filter((s) => s.reason === reason).map((s) => s.brandName))].sort();

describe("parseBulkDealMatrix — header & posisi kolom", () => {
  it("header di baris 2, tanpa error", () => {
    expect(res.errors).toEqual([]);
    expect(res.headerRow).toBe(2);
  });

  it("dua kolom 'Leads': C = tahap pipeline (tidak disimpan), N = leads_type", () => {
    expect(BULK_DEAL_COLUMNS[2]).toMatchObject({ key: "pipelineStage", header: "Leads" });
    expect(BULK_DEAL_COLUMNS[13]).toMatchObject({ key: "leadsType", header: "Leads" });
    const leads = new Set(res.rows.map((r) => r.leadsType));
    expect(leads.has("Deal")).toBe(false);
  });

  it("kolom bergeser → seluruh file ditolak", () => {
    const shifted = matrix.map((r) => [r[0], r[2], r[1], ...r.slice(3)]);
    const bad = parseBulkDealMatrix(shifted);
    expect(bad.rows).toEqual([]);
    expect(bad.errors.join(" ")).toMatch(/Kolom B harus "Bizdev"/);
  });
});

describe("duplikat & skip (DECISIONS D-2026-10-20-4)", () => {
  it("Shop ID dobel dengan nama sama → semua baris kelompoknya di-skip", () => {
    expect(skippedNames("duplikat_persis")).toEqual(
      ["Baseus official store", "Bintang Toedjoe Store", "DiliDili.Shop", "Footage", "For Skin's Sake"].sort()
    );
    for (const name of ["Baseus official store", "Footage"]) {
      expect(res.rows.some((r) => r.brandName === name)).toBe(false);
    }
    const bt = res.skipped.filter((s) => s.brandName === "Bintang Toedjoe Store");
    expect(bt).toHaveLength(2);
    expect(bt[0].otherRows).toEqual([bt[1].sheetRow]);
  });

  it("Shop ID sama dengan nama berbeda → di-LOAD semua sebagai brand terpisah", () => {
    expect(loaded("7494925848126982530")).toEqual(["Buavita", "Masak Apa Hari Ini"]);
    expect(loaded("7494705179784546170")).toEqual(["Cottonela.idn", "cottonella.idn"]);
    expect(loaded("7495181208386570479")).toEqual(["Daily Care by Unilever", "Dove", "Lifebuoy"]);
    expect(loaded("7495212045229000936")).toEqual(["Flimcol By Flimbeauty", "flimbeauty.id"]);
    expect(loaded("7496203411210995779")).toEqual(["Foca Kue Sachima Official", "LUCKYMORE ID"]);
    expect(loaded("7495001863012255803")).toEqual(["GOKOCO.ID", "Gokoco"]);
    expect(loaded("7494895786286418213")).toEqual(["Royal Fragrance", "Royal Fragrance ID"]);
    expect(loaded("7495209408569313450")).toEqual(["Sidomuncul Tolak Angin", "tokosekarwangi"]);
    expect(loaded("7495129254209685773")).toEqual(["Unilever Official Store", "Vixal"]);
  });

  it("tanpa Shop ID → skip", () => {
    expect(skippedNames("tanpa_shop_id")).toEqual(
      ["BIC MALL - BOYA Indonesia OS", "Brand Testing", "Cooger HomeLiving Mall - COOGER Electric"].sort()
    );
  });

  it("tanpa nama brand (baris 809) → skip + lapor", () => {
    expect(res.skipped.filter((s) => s.reason === "tanpa_nama_brand")).toEqual([
      expect.objectContaining({ shopId: "7494931568031533225", brandName: "" }),
    ]);
  });
});

describe("normalisasi nilai", () => {
  const byName = (n: string) => res.rows.find((r) => r.brandName === n)!;

  it("status: trim, variasi running → running_1st_month, kosong → null + peringatan", () => {
    expect(byName("20Mefree").status).toBe("reguler");
    expect(byName("H&H Skincare").status).toBe("running_1st_month");
    expect(byName("Daily Care by Unilever").status).toBe("running_1st_month");
    expect(byName("Bintang leather").status).toBe("running_1st_month");
    for (const n of ["MIORIO", "USMILE", "Vibrant Glamour"]) {
      expect(byName(n).status, n).toBeNull();
      expect(byName(n).warnings).toContain("Status kosong → disimpan NULL");
    }
  });

  it("Bizdev: 'Non BD Hande' = label tanpa handler; dua nama dipisah koma", () => {
    expect(byName("20Mefree")).toMatchObject({ bizdevLabel: "Non BD Hande", bizdevNames: [] });
    expect(byName("Bintang leather").bizdevNames).toEqual(["Fanny", "Laila S"]);
    expect(parseBizdev("Non BD Handle").names).toEqual([]);
  });

  it("Sample/Flash Sale/Ads urutan acak → urutan baku", () => {
    expect(parseSupportTypes("Sample, Ads, Flash Sale").types).toEqual(["sample", "flash_sale", "ads"]);
    expect(parseSupportTypes("Flash Sale, Ads, Sample").types).toEqual(["sample", "flash_sale", "ads"]);
    expect(parseSupportTypes("Ads").types).toEqual(["ads"]);
    expect(parseSupportTypes("").types).toBeNull();
  });

  it("Campaign Ops: 'Non Campaign Ops' → null; nama → apa adanya", () => {
    expect(res.rows.some((r) => r.campaignOpsName === "Diena")).toBe(true);
    expect(res.rows.every((r) => r.campaignOpsName !== "Non Campaign Ops")).toBe(true);
  });

  it("GMV TAP 'Rp1.095.105' & 'Rp1,075,484,867' → angka; exp date teks → ISO", () => {
    expect(byName("20Mefree").gmvTap).toBe(0);
    expect(byName("20Mefree").avgPrice).toBe(120000);
    expect(byName("20Mefree").expDate).toBe("2027-02-28");
  });

  it("6 nilai Ads Brand lama di luar daftar → dilaporkan apa adanya", () => {
    const opts = [
      "Brand Barcode Bulking - Cek BD", "Brand Invoice Bulking - Cek BD", "Brand Invoice One Time - Cek BD",
      "Ads By Brand - Minta Barcode", "Transfer Daily by Brand", "Tidak Support Ads",
    ];
    // (Nomor baris sheet asli 39/286/406/446/476/598 — fixture ini potongan, jadi
    // nomor barisnya berbeda; nomor asli diverifikasi oleh laporan dry-run.)
    expect(outOfListValues(res.rows, "adsBrand", opts).map((o) => [o.brandName, o.shopId, o.value])).toEqual([
      ["Anessa Indonesia", "7494033681309861696", "Daily (Barcode/Invoicing)"],
      ["H&H Skincare", "7494083747781968989", "Not yet Support"],
      ["Le Ding Ding", "7495478238059465663", "Campaign Bulking"],
      ["Maybelline Indonesia", "7494048773396071648", "Daily (Barcode/Invoicing)"],
      ["MOELL OFFICIAL", "7494840462703167559", "Daily (Barcode), Minim Support"],
      ["Purbasari Indonesia", "7494083658890053184", "Daily (Barcode/Invoicing)"],
    ]);
  });

  it("countdown dihitung saat render", () => {
    expect(countdownDays("2026-10-31", "2026-10-20")).toBe(11);
    expect(countdownDays(null, "2026-10-20")).toBeNull();
  });
});

describe("export .xlsx — header persis sheet & round-trip", () => {
  it("dua baris header sama persis, lalu dibaca ulang identik", () => {
    const records = res.rows.map((r) => bulkRowToRecord(r, r.campaignOpsName));
    const wb = buildBulkDealWorkbook(records);
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const back = readSheetMatrix(new Uint8Array(buf), "x.xlsx");
    expect(back[1].slice(0, BULK_DEAL_COLUMNS.length)).toEqual(matrix[1].slice(0, BULK_DEAL_COLUMNS.length));
    expect(back[0].slice(0, BULK_DEAL_COLUMNS.length)).toEqual(BULK_DEAL_COLUMNS.map((c) => c.group));
    const again = parseBulkDealMatrix(back);
    expect(again.errors).toEqual([]);
    const strip = (rows: typeof res.rows) =>
      rows.map(({ sheetRow: _s, warnings: _w, extraNote: _e, statusRaw: _r, ...rest }) => rest);
    expect(strip(again.rows)).toEqual(strip(res.rows));
  });
});

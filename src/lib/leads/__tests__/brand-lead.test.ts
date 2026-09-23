import { describe, expect, it } from "vitest";
import { brandLeadSchema, normalizePhoneId } from "../brand-lead";

describe("normalizePhoneId", () => {
  it("0812... -> +62812...", () => {
    expect(normalizePhoneId("081234567890")).toBe("+6281234567890");
  });
  it("62812... -> +62812...", () => {
    expect(normalizePhoneId("6281234567890")).toBe("+6281234567890");
  });
  it("+62812... tetap apa adanya", () => {
    expect(normalizePhoneId("+6281234567890")).toBe("+6281234567890");
  });
  it("membuang spasi/strip", () => {
    expect(normalizePhoneId("0812-3456-7890")).toBe("+6281234567890");
    expect(normalizePhoneId("0812 3456 7890")).toBe("+6281234567890");
  });
  it("string tanpa digit -> null", () => {
    expect(normalizePhoneId("abc")).toBeNull();
  });
});

describe("brandLeadSchema", () => {
  const withShop = { source: "event", shop_name: "Toko Contoh" };
  const withContact = { source: "event", contacts: [{ lead_name: "Budi" }] };

  it("valid: shop_name terisi, tanpa kontak", () => {
    const r = brandLeadSchema.safeParse(withShop);
    expect(r.success).toBe(true);
  });

  it("valid: kontak terisi, tanpa shop_name", () => {
    const r = brandLeadSchema.safeParse(withContact);
    expect(r.success).toBe(true);
  });

  it("gagal: shop_name kosong DAN semua kontak kosong", () => {
    const r = brandLeadSchema.safeParse({ source: "event", contacts: [{}] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/Nama Toko atau satu kontak/);
    }
  });

  it("gagal: source tidak diisi", () => {
    const r = brandLeadSchema.safeParse({ shop_name: "Toko" });
    expect(r.success).toBe(false);
  });

  it("gagal: source di luar enum", () => {
    const r = brandLeadSchema.safeParse({ source: "tidak_valid", shop_name: "Toko" });
    expect(r.success).toBe(false);
  });

  it("normalisasi nomor HP kontak", () => {
    const r = brandLeadSchema.safeParse({
      source: "event",
      contacts: [{ lead_name: "Budi", phone: "081234567890" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contacts[0].phone).toBe("+6281234567890");
  });

  it("gagal: email kontak tidak valid", () => {
    const r = brandLeadSchema.safeParse({
      source: "event",
      shop_name: "Toko",
      contacts: [{ email: "bukan-email" }],
    });
    expect(r.success).toBe(false);
  });

  it("email dilower-case", () => {
    const r = brandLeadSchema.safeParse({
      source: "event",
      shop_name: "Toko",
      contacts: [{ email: "Budi@Example.COM" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contacts[0].email).toBe("budi@example.com");
  });

  it("marketing_budget: Rupiah string diparse ke number", () => {
    const r = brandLeadSchema.safeParse({ ...withShop, marketing_budget: "Rp5.000.000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.marketing_budget).toBe(5_000_000);
  });

  it("marketing_budget kosong -> undefined, bukan 0", () => {
    const r = brandLeadSchema.safeParse({ ...withShop, marketing_budget: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.marketing_budget).toBeUndefined();
  });

  it("target_roas: angka >= 0 diterima, negatif ditolak", () => {
    expect(brandLeadSchema.safeParse({ ...withShop, target_roas: 3.5 }).success).toBe(true);
    expect(brandLeadSchema.safeParse({ ...withShop, target_roas: -1 }).success).toBe(false);
  });

  it("platforms & brand_support hanya menerima nilai dalam enum", () => {
    expect(
      brandLeadSchema.safeParse({ ...withShop, platforms: ["shopee", "tiktok_shop"] }).success
    ).toBe(true);
    expect(brandLeadSchema.safeParse({ ...withShop, platforms: ["lazada"] }).success).toBe(false);
    expect(
      brandLeadSchema.safeParse({ ...withShop, brand_support: ["tap", "sample"] }).success
    ).toBe(true);
    expect(brandLeadSchema.safeParse({ ...withShop, brand_support: ["unknown"] }).success).toBe(false);
  });

  it("status default 'baru' bila tidak diisi", () => {
    const r = brandLeadSchema.safeParse(withShop);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("baru");
  });
});

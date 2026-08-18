import { describe, expect, it } from "vitest";
import { CAMPAIGN_TYPES, CAMPAIGN_TYPE_LABEL } from "@/lib/deals/campaign-type";
import {
  campaignDefaultsFromForm,
  isEmptyProductCard,
  productCardIssues,
  productCardSchema,
  productCardTarget,
} from "@/lib/deals/product-card";

/** Isian form apa adanya: FormData selalu mengirim string, termasuk string kosong. */
function form(over: Record<string, string> = {}) {
  return {
    campaign_id: "",
    product_name: "",
    product_id: "",
    price: "",
    shop_name: "",
    shop_id: "",
    effective_start: "",
    effective_end: "",
    commission_pct: "",
    partner_commission_pct: "",
    creator_shop_ads_commission_pct: "",
    partner_shop_ads_commission_pct: "",
    product_link: "",
    deal_by: "",
    pic_tap: "",
    ...over,
  };
}

describe("form kartu produk (Registrasi Deal)", () => {
  it("semua pertanyaan opsional — termasuk Product Name", () => {
    const parsed = productCardSchema.safeParse(form({ product_name: "   " }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.product_name).toBeUndefined();
    expect(productCardIssues(parsed.data)).toEqual({});
  });

  it("kartu dengan Product Name terisi tetap dibaca apa adanya", () => {
    const parsed = productCardSchema.parse(form({ product_name: " Serum Vit C 30ml " }));
    expect(parsed.product_name).toBe("Serum Vit C 30ml");
    expect(isEmptyProductCard(parsed)).toBe(false);
  });

  it("form yang kosong SELURUHNYA ditolak — kartunya tak menyimpan informasi apa pun", () => {
    expect(isEmptyProductCard(productCardSchema.parse(form()))).toBe(true);

    // Satu kolom mana pun sudah cukup: tidak ada kolom tertentu yang diwajibkan.
    const satuKolom: Record<string, string>[] = [
      { product_name: "Serum" },
      { product_id: "1729859716545022432" },
      { shop_name: "DVARA" },
      { price: "0" },
    ];
    for (const isian of satuKolom) {
      expect(isEmptyProductCard(productCardSchema.parse(form(isian)))).toBe(false);
    }
  });

  it('kolom kosong jadi undefined, bukan 0 — 0% komisi ≠ "belum diisi"', () => {
    const kosong = productCardSchema.parse(form());
    expect(kosong.commission_pct).toBeUndefined();
    expect(kosong.price).toBeUndefined();

    const nol = productCardSchema.parse(form({ commission_pct: "0" }));
    expect(nol.commission_pct).toBe(0);
  });

  it("Tipe Campaign / Ads Budget / Service Fee tidak lagi ditanyakan di form ini", () => {
    // Kedua nominal milik pasangan (project, shop) di tab Project BD, jadi jawaban di
    // form registrasi cuma melahirkan angka yang bertabrakan dengan angka project.
    const parsed = productCardSchema.parse(
      form({ campaign_type: "paid", ads_budget: "50000000", service_fee: "5000000" })
    );
    expect(parsed).not.toHaveProperty("campaign_type");
    expect(parsed).not.toHaveProperty("ads_budget");
    expect(parsed).not.toHaveProperty("service_fee");
    // Tidak ada lagi aturan wajib yang bergantung tipe campaign.
    expect(productCardIssues(parsed)).toEqual({});
  });

  it("tujuan simpan ditentukan identitas produk, bukan pertanyaan tambahan", () => {
    const target = (over: Record<string, string>) =>
      productCardTarget(productCardSchema.parse(form(over)));

    // Ada identitas produk → kartu di tab Produk TAP.
    expect(target({ product_name: "Serum Vit C" })).toBe("product_card");
    expect(target({ product_id: "1729859716545022432" })).toBe("product_card");
    // Shop Name ikut terisi pun tetap kartu produk: produknya sudah jelas.
    expect(target({ product_name: "Serum Vit C", shop_name: "DVARA" })).toBe("product_card");

    // Shop saja → deal shop di tab Deal Brand, BELUM jadi kartu Produk TAP.
    expect(target({ shop_name: "DVARA" })).toBe("brand_deal");
    expect(target({ shop_id: "7495123456789" })).toBe("brand_deal");
    // Kolom lain yang terisi tidak mengubahnya: yang menentukan tetap identitas produk.
    expect(target({ shop_name: "DVARA", price: "231000", commission_pct: "7" })).toBe("brand_deal");

    // Tidak ada identitas produk maupun shop → tidak ada yang bisa didaftarkan.
    expect(target({ campaign_id: "7662920044527912724" })).toBe("unidentified");
    expect(target({ price: "231000" })).toBe("unidentified");
  });

  it("menolak Product ID / Shop ID yang bukan angka", () => {
    for (const field of ["product_id", "shop_id"]) {
      const parsed = productCardSchema.safeParse(form({ [field]: "173-abc" }));
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      expect(parsed.error.issues[0].path[0]).toBe(field);
    }
  });

  it("menolak masa berlaku terbalik", () => {
    const d = productCardSchema.parse(
      form({ effective_start: "2026-03-01", effective_end: "2026-02-01" })
    );
    expect(productCardIssues(d).effective_end).toBeTruthy();

    const ok = productCardSchema.parse(
      form({ effective_start: "2026-02-01", effective_end: "2026-03-01" })
    );
    expect(productCardIssues(ok)).toEqual({});
  });

  it("tanpa jawaban apa pun, upload tidak menyentuh kolom Deal by / PIC TAP", () => {
    // Perilaku "Upload Master Product List" di tab Produk TAP, yang memang tidak
    // menanyakan keduanya.
    const { defaults, error } = campaignDefaultsFromForm({ deal_by: "", pic_tap: "" });
    expect(error).toBeUndefined();
    expect(defaults).toEqual({});
  });

  it("upload tidak lagi menerima Tipe Campaign / Ads Budget / Service Fee", () => {
    // Ketiganya sudah tidak ditanyakan; kalau pun ikut terkirim, tidak boleh berubah
    // jadi kolom yang ditulis importer ke kartu produk.
    const { defaults, error } = campaignDefaultsFromForm({
      campaign_type: "paid",
      ads_budget: "50000000",
      service_fee: "5000000",
    } as Record<string, unknown>);
    expect(error).toBeUndefined();
    expect(defaults).toEqual({});
  });

  it("Deal by & PIC TAP ikut dijawab sekali untuk seluruh file", () => {
    const dealBy = "11111111-1111-4111-8111-111111111111";
    const picTap = "22222222-2222-4222-8222-222222222222";
    const { defaults, error } = campaignDefaultsFromForm({ deal_by: dealBy, pic_tap: picTap });
    expect(error).toBeUndefined();
    expect(defaults).toEqual({ deal_by: dealBy, pic_tap: picTap });
  });

  it("Deal by & PIC TAP kosong tidak masuk defaults (kolomnya tidak disentuh)", () => {
    expect(campaignDefaultsFromForm({ deal_by: "", pic_tap: "" }).defaults).toEqual({});
  });

  it("menolak Deal by / PIC TAP yang bukan id anggota tim", () => {
    expect(campaignDefaultsFromForm({ deal_by: "Budi" }).error).toBeTruthy();
    expect(campaignDefaultsFromForm({ pic_tap: "42" }).error).toBeTruthy();
  });

  it("tiga tipe campaign dengan label yang dipakai UI", () => {
    expect(CAMPAIGN_TYPES.map((t) => t.label)).toEqual([
      "Paid Campaign",
      "Campaign Sample (non-berbayar)",
      "Komisi extra (non-berbayar)",
    ]);
    // Tipe campaign masih dipakai kolom tabel Produk TAP & tombol Edit shop di tab
    // Deal Brand — yang hilang cuma aturan "paid wajib nominal".
    expect(CAMPAIGN_TYPE_LABEL.paid).toBe("Paid Campaign");
  });
});

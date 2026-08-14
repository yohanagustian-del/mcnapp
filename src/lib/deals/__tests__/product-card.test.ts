import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_LABEL,
  CAMPAIGN_TYPE_NEEDS_BUDGET,
} from "@/lib/deals/campaign-type";
import { productCardIssues, productCardSchema } from "@/lib/deals/product-card";

/** Isian form apa adanya: FormData selalu mengirim string, termasuk string kosong. */
function form(over: Record<string, string> = {}) {
  return {
    campaign_id: "",
    product_name: "Serum Vit C 30ml",
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
    campaign_type: "",
    ads_budget: "",
    service_fee: "",
    deal_by: "",
    pic_tap: "",
    ...over,
  };
}

describe("form kartu produk (Registrasi Deal)", () => {
  it("hanya Product Name yang wajib — sisanya boleh kosong", () => {
    const parsed = productCardSchema.safeParse(form());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.product_name).toBe("Serum Vit C 30ml");
    expect(productCardIssues(parsed.data)).toEqual({});
  });

  it("menolak Product Name kosong", () => {
    const parsed = productCardSchema.safeParse(form({ product_name: "   " }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0].path[0]).toBe("product_name");
  });

  it('kolom kosong jadi undefined, bukan 0 — 0% komisi ≠ "belum diisi"', () => {
    const kosong = productCardSchema.parse(form());
    expect(kosong.commission_pct).toBeUndefined();
    expect(kosong.price).toBeUndefined();

    const nol = productCardSchema.parse(form({ commission_pct: "0" }));
    expect(nol.commission_pct).toBe(0);
  });

  it("Ads Budget & Service Fee wajib HANYA untuk komisi extra", () => {
    const extra = productCardSchema.parse(form({ campaign_type: CAMPAIGN_TYPE_NEEDS_BUDGET }));
    expect(productCardIssues(extra)).toEqual({
      ads_budget: expect.any(String),
      service_fee: expect.any(String),
    });

    const lengkap = productCardSchema.parse(
      form({ campaign_type: CAMPAIGN_TYPE_NEEDS_BUDGET, ads_budget: "50000000", service_fee: "0" })
    );
    expect(productCardIssues(lengkap)).toEqual({});

    // Ads budget 0 adalah jawaban yang sah dan tidak boleh dianggap kosong.
    expect(lengkap.service_fee).toBe(0);

    for (const tipe of ["paid", "sample"]) {
      const lain = productCardSchema.parse(form({ campaign_type: tipe }));
      expect(productCardIssues(lain)).toEqual({});
    }
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

  it("tiga tipe campaign dengan label yang dipakai UI", () => {
    expect(CAMPAIGN_TYPES.map((t) => t.label)).toEqual([
      "Paid Campaign",
      "Campaign Sample (non-berbayar)",
      "Komisi extra (non-berbayar)",
    ]);
    expect(CAMPAIGN_TYPE_LABEL[CAMPAIGN_TYPE_NEEDS_BUDGET]).toBe("Komisi extra (non-berbayar)");
  });
});

import { describe, expect, it } from "vitest";
import { slotAdsDisplay } from "../ads-display";
import type { SlotAdsRequestSummary } from "../types";

const req: SlotAdsRequestSummary = {
  slotId: 1, requestId: 42, status: "menunggu_finance",
  fundingType: "creator_budget", paymentMethod: "invoice", budget: 750_000,
};

describe("slotAdsDisplay — kolom ads kalender & daftar ringkas (D-2026-10-31-7)", () => {
  it("request ads menang atas ads_payer lama", () => {
    const d = slotAdsDisplay({ status: "scheduled", ads_payer: "brand", ads_note: "Rp500rb" }, req);
    expect(d.source).toBe("request");
    expect(d.label).toBe("Creator Budget · Invoice · Menunggu ACC");
    expect(d.budget).toBe(750_000);
    expect(d.legacyNote).toBeNull();
    expect(d.requestId).toBe(42);
    expect(d.facetValue).toBe("creator_budget");
  });

  it("slot lama tanpa request menampilkan ads_payer/ads_note dengan penanda (lama)", () => {
    const d = slotAdsDisplay({ status: "scheduled", ads_payer: "mea", ads_note: " invoicing MEA " }, null);
    expect(d.source).toBe("legacy");
    expect(d.label).toMatch(/\(lama\)$/);
    expect(d.legacyNote).toBe("invoicing MEA");
    expect(d.facetValue).toBe("legacy:mea");
    expect(d.requestId).toBeNull();
  });

  it("catatan lama tanpa pembayar tetap terbaca, tanpa label", () => {
    const d = slotAdsDisplay({ status: "tentative", ads_payer: null, ads_note: "Rp1jt" }, undefined);
    expect(d.source).toBe("legacy");
    expect(d.label).toBeNull();
    expect(d.legacyNote).toBe("Rp1jt");
  });

  it("slot OFF tidak punya ads; slot kosong = belum ada request", () => {
    expect(slotAdsDisplay({ status: "off", ads_payer: "brand", ads_note: null }, req).source).toBe("off");
    const none = slotAdsDisplay({ status: "scheduled", ads_payer: null, ads_note: "  " }, null);
    expect(none.source).toBe("none");
    expect(none.label).toBeNull();
  });
});

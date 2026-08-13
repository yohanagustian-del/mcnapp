import { describe, expect, it } from "vitest";
import { NO_CAMPAIGN } from "@/lib/m10/products";

/**
 * Kunci baris katalog = (campaign_id, product_id), sama dengan primary key di
 * migrasi 0040. Fungsi ini menyalin aturan kunci yang dipakai parser supaya
 * perilaku "tidak saling menimpa" bisa diuji tanpa menyentuh database.
 */
function rowKey(campaignId: string | null, productId: string): string {
  return `${campaignId || NO_CAMPAIGN} ${productId}`;
}

describe("kepemilikan baris Produk TAP", () => {
  it("produk sama di campaign berbeda = dua baris terpisah", () => {
    // Kasus nyata: dua bizdev memegang room campaign berbeda dan kebetulan
    // menawarkan produk yang sama. Sebelum 0040 keduanya berebut satu baris.
    const bizdevA = rowKey("7662920044527912724", "1729859716545022432");
    const bizdevB = rowKey("7999111222333444555", "1729859716545022432");

    expect(bizdevA).not.toBe(bizdevB);
  });

  it("produk sama di campaign sama = satu baris (upload ulang menimpa dirinya)", () => {
    const first = rowKey("7662920044527912724", "1729859716545022432");
    const reupload = rowKey("7662920044527912724", "1729859716545022432");

    expect(first).toBe(reupload);
  });

  it("baris derive ingest memakai sentinel dan tidak menabrak campaign mana pun", () => {
    const derived = rowKey(null, "1729859716545022432");
    const campaign = rowKey("7662920044527912724", "1729859716545022432");

    expect(derived).toBe(`${NO_CAMPAIGN} 1729859716545022432`);
    expect(derived).not.toBe(campaign);
  });

  it("sentinel bukan string kosong — kolom kunci tidak boleh null/kosong", () => {
    // campaign_id ikut primary key, jadi nilai kosong akan ditolak Postgres.
    expect(NO_CAMPAIGN).toBeTruthy();
    expect(NO_CAMPAIGN.trim()).toBe(NO_CAMPAIGN);
  });

  it("kunci tidak ambigu untuk id yang saling berimbuhan", () => {
    // Pemisah spasi penting: tanpa pemisah, ("12","3456") dan ("123","456")
    // akan menghasilkan kunci yang sama persis.
    expect(rowKey("12", "3456")).not.toBe(rowKey("123", "456"));
  });
});

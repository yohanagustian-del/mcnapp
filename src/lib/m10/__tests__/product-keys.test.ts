import { describe, expect, it } from "vitest";
import {
  BULK_LIMIT,
  groupKeysByCampaign,
  parseProductRowKeys,
  productRowKey,
} from "@/lib/m10/product-keys";
import { NO_CAMPAIGN } from "@/lib/m10/products";

/** Bentuk kiriman form bulk: JSON array berisi hasil productRowKey(). */
function payload(keys: string[]): string {
  return JSON.stringify(keys);
}

describe("kunci baris untuk aksi massal Produk TAP", () => {
  it("bolak-balik encode → parse mengembalikan pasangan yang sama", () => {
    const keys = [
      productRowKey("7662920044527912724", "1729859716545022432"),
      productRowKey(null, "1729859716545022432"),
      productRowKey("DEAL-XK3M9", "PRD-AB3KP"),
    ];

    expect(parseProductRowKeys(payload(keys))).toEqual([
      { campaignId: "7662920044527912724", productId: "1729859716545022432" },
      { campaignId: NO_CAMPAIGN, productId: "1729859716545022432" },
      { campaignId: "DEAL-XK3M9", productId: "PRD-AB3KP" },
    ]);
  });

  it("kunci tidak ambigu untuk id yang saling berimbuhan", () => {
    // Pemisah teks polos akan menyamakan ("12","3456") dengan ("123","456").
    expect(productRowKey("12", "3456")).not.toBe(productRowKey("123", "456"));
  });

  it("campaign kosong memakai sentinel yang sama dengan database", () => {
    expect(productRowKey("", "173")).toBe(productRowKey(NO_CAMPAIGN, "173"));
  });

  it("membuang duplikat supaya baris tidak diproses dua kali", () => {
    const k = productRowKey("77", "173");
    expect(parseProductRowKeys(payload([k, k, k]))).toHaveLength(1);
  });

  it("membuang entri rusak, bukan menebak baris lain", () => {
    const valid = productRowKey("77", "173");
    const raw = JSON.stringify([
      valid,
      "bukan json",
      JSON.stringify(["cuma-satu"]),
      JSON.stringify(["77", 173]),
      JSON.stringify(["", ""]),
      42,
    ]);
    expect(parseProductRowKeys(raw)).toEqual([{ campaignId: "77", productId: "173" }]);
  });

  it("menolak payload yang bukan array JSON", () => {
    expect(() => parseProductRowKeys("{}")).toThrow();
    expect(() => parseProductRowKeys("bukan json")).toThrow();
  });

  it("mengelompokkan per campaign supaya query cukup satu per campaign", () => {
    const keys = parseProductRowKeys(
      payload([
        productRowKey("77", "1"),
        productRowKey("77", "2"),
        productRowKey("88", "3"),
      ])
    );
    const grouped = groupKeysByCampaign(keys);

    expect(grouped.size).toBe(2);
    expect(grouped.get("77")).toEqual(["1", "2"]);
    expect(grouped.get("88")).toEqual(["3"]);
  });

  it("batas bulk masuk akal untuk sekali kerja", () => {
    expect(BULK_LIMIT).toBeGreaterThanOrEqual(50);
    expect(BULK_LIMIT).toBeLessThanOrEqual(500);
  });
});

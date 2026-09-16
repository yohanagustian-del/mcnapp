import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseLiveProductFile, parseLiveTrendFile } from "../live-parse";

function xlsxFile(rows: Record<string, unknown>[], name = "data.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseLiveProductFile", () => {
  it("parses rows and sums totals — this is the session's GMV source of truth", async () => {
    const file = xlsxFile([
      {
        "Product ID": "PID-1", "Product name": "Serum X", "Attributed GMV": 1_100_000,
        "Attributed items sold": 22, Customers: 15, AOV: 50000,
        "Attributed orders": 20, "Product Impressions": 500, CTR: "4.2%",
        "Added to cart": 30, CTOR: "10%", "Watch GPM": 25000, "Product Clicks": 40,
      },
      {
        "Product ID": "PID-2", "Product name": "Toner Y", "Attributed GMV": 400_000,
        "Attributed items sold": 8, Customers: 5, AOV: 50000,
        "Attributed orders": 7, "Product Impressions": 200, CTR: "3%",
        "Added to cart": 10, CTOR: "8%", "Watch GPM": 12000, "Product Clicks": 15,
      },
    ]);

    const result = await parseLiveProductFile(file);
    expect(result.missingColumns).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ productId: "PID-1", productName: "Serum X", gmv: 1_100_000 });
    expect(result.totals).toEqual({
      gmv: 1_500_000, orders: 27, items: 30, customers: 20,
      productImpressions: 700, productClicks: 55, addedToCart: 40,
    });
  });

  it("reports missing columns instead of throwing", async () => {
    const file = xlsxFile([{ "Product ID": "PID-1", "Attributed GMV": 100 }]);
    const result = await parseLiveProductFile(file);
    expect(result.missingColumns).toEqual(
      expect.arrayContaining(["product_name", "attributed_items_sold", "customers"])
    );
    expect(result.rows[0].gmv).toBe(100);
  });
});

describe("parseLiveTrendFile", () => {
  it("parses per-interval rows without treating its own GMV as authoritative on its own", async () => {
    const file = xlsxFile([
      {
        Time: "19:00", "Attributed GMV": 300_000, "Attributed items sold": 5,
        Customers: 4, "Attributed orders": 5, Viewers: 120, Views: 800,
        "Product Impressions": 200, "Product Clicks": 30, "New followers": 3,
        Shares: 2, Comments: 10, Likes: 40,
      },
      {
        Time: "19:30", "Attributed GMV": 500_000, "Attributed items sold": 9,
        Customers: 6, "Attributed orders": 8, Viewers: 180, Views: 900,
        "Product Impressions": 250, "Product Clicks": 35, "New followers": 5,
        Shares: 4, Comments: 15, Likes: 60,
      },
    ]);

    const result = await parseLiveTrendFile(file);
    expect(result.missingColumns).toEqual([]);
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0].time).toBe("19:00");
    expect(result.totals).toEqual({ gmv: 800_000, viewersPeak: 180, views: 1700 });
  });
});

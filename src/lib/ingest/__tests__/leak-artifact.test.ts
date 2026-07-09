import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  BD_SHOP_SUMMARY_HEADER,
  detectArtifactFormat,
  parseBdOpportunityFile,
  parseLeakDetailFile,
} from "../leak-artifact";

/** Build an .xlsx File from a map of sheetName → array-of-arrays (matches artifact layout). */
function artifactFile(sheets: Record<string, unknown[][]>, name = "artifact.xlsx"): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Real-world artifact period 2026-05-27 to 2026-06-23 crosses a month → NOT W1-W5.
// These tests use a valid W1-W5 window (June W1 = 1-7) for the happy path, and the
// cross-month real range only in the reject case.
function execSheet(periodLine: string): unknown[][] {
  return [
    ["UMA AGENCY LINK INTELLIGENCE REPORT"],
    [periodLine],
    [""],
    ["KEY INSIGHTS"],
  ];
}

function creatorBlock(name: string, bullets: string[]): unknown[][] {
  return [
    [`▶ CREATOR: ${name}`],
    ["Ringkasan:"],
    ...bullets.map((b) => [b]),
    ["Tabel Produk Bocor (Partnered Shops - Affiliate GMV > 0):"],
    ["Product ID", "Product Name", "Shop ID", "Shop Name", "L1", "L2", "Affiliate GMV (MCN)"],
    ["1.73175E+18", "CeraVe Cleanser", "7495725536740870256", "Cerave", "Beauty", "Skincare", "Rp197.611"],
  ];
}

const FULL_BULLETS = [
  "• Total Affiliate GMV: Rp361.180.636",
  "• Agency Link GMV (TAP): Rp26.968.526",
  "• Bocor (Leak): Rp335.467.486  ← Commission lost on partnered shops",
  "• Peluang BD (Non-Partnered Shops): Rp12.840",
  "• Direct GMV: Rp317.176.676",
  "• Agency Link Effectiveness: 7.5%",
  "• Partnered Shops Promoted: 11 | Non-Partnered: 1",
];

describe("parseLeakDetailFile", () => {
  it("extracts period + per-creator rollup bullets (Rp dot-thousands)", async () => {
    const file = artifactFile({
      "Executive Summary": execSheet("Period: 2026-06-01 to 2026-06-07 | Generated: 2026-06-09 07:30"),
      Creator_Detail_Sections: [
        ["DETAILED LEAK ANALYSIS PER CREATOR"],
        [""],
        ...creatorBlock("ivenameiliani", FULL_BULLETS),
      ],
      Leaked_Products_All: [["ignored"]],
    });

    const res = await parseLeakDetailFile(file);
    expect(res.periodStart).toBe("2026-06-01");
    expect(res.periodEnd).toBe("2026-06-07");
    expect(res.creators).toHaveLength(1);
    const c = res.creators[0];
    expect(c.creatorName).toBe("ivenameiliani");
    expect(c.gmvAffiliateTotal).toBe(361_180_636);
    expect(c.gmvTap).toBe(26_968_526);
    expect(c.gmvBocor).toBe(335_467_486);
    expect(c.bdOpportunityGmv).toBe(12_840);
    expect(c.directGmv).toBe(317_176_676);
    expect(c.effectiveness).toBeCloseTo(0.075, 5);
    expect(res.skipped).toHaveLength(0);
  });

  it("parses multiple creator blocks", async () => {
    const file = artifactFile({
      "Executive Summary": execSheet("Period: 2026-06-08 to 2026-06-14 | Generated: x"),
      Creator_Detail_Sections: [
        ["HEADER"],
        ...creatorBlock("alpha", FULL_BULLETS),
        [""],
        ...creatorBlock("beta", FULL_BULLETS),
      ],
    });
    const res = await parseLeakDetailFile(file);
    expect(res.creators.map((c) => c.creatorName)).toEqual(["alpha", "beta"]);
  });

  it("missing bullet → null value + skipped note (never crash)", async () => {
    const missingTap = FULL_BULLETS.filter((b) => !b.startsWith("• Agency Link GMV"));
    const file = artifactFile({
      "Executive Summary": execSheet("Period: 2026-06-01 to 2026-06-07 | Generated: x"),
      Creator_Detail_Sections: [["H"], ...creatorBlock("gamma", missingTap)],
    });
    const res = await parseLeakDetailFile(file);
    expect(res.creators[0].gmvTap).toBeNull();
    expect(res.creators[0].gmvAffiliateTotal).toBe(361_180_636);
    expect(res.skipped.some((s) => s.includes("Agency Link GMV"))).toBe(true);
  });

  it("rejects a non-W1-W5 (cross-month) period at the run layer — parser still extracts it", async () => {
    // The real sample range crosses months; the parser returns it (the W1-W5 gate
    // lives in uploadLeakArtifact, tested separately). Here we just confirm extraction.
    const file = artifactFile({
      "Executive Summary": execSheet("Period: 2026-05-27 to 2026-06-23 | Generated: x"),
      Creator_Detail_Sections: [["H"], ...creatorBlock("delta", FULL_BULLETS)],
    });
    const res = await parseLeakDetailFile(file);
    expect(res.periodStart).toBe("2026-05-27");
    expect(res.periodEnd).toBe("2026-06-23");
  });

  it("throws when the Period row is absent", async () => {
    const file = artifactFile({
      "Executive Summary": [["UMA REPORT"], ["no period here"]],
      Creator_Detail_Sections: [["H"], ...creatorBlock("x", FULL_BULLETS)],
    });
    await expect(parseLeakDetailFile(file)).rejects.toThrow(/Period/);
  });
});

describe("parseBdOpportunityFile", () => {
  const HEADER = [...BD_SHOP_SUMMARY_HEADER];

  it("parses BD_Shop_Summary; 19-digit shop id stays a string", async () => {
    const file = artifactFile({
      BD_Shop_Summary: [
        ["BD OPPORTUNITY: SHOPS WITHOUT AGENCY COLLABORATION"],
        [""],
        ["Total Peluang GMV: Rp171.408.369 across 73 shops"],
        [""],
        HEADER,
        ["1", "7496144953400855459", "ALV Jeans Premium", "Womenswear", "Women's Bottoms", "Rp105.983.915", "1", "3"],
        ["2", "7494515292378204243", "pj.store11", "Womenswear", "Women's Bottoms", "Rp14.651.775", "2", "4"],
      ],
      BD_Detail_Per_Shop: [["ignored"]],
    });
    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(2);
    expect(res.shops[0].shopId).toBe("7496144953400855459");
    expect(typeof res.shops[0].shopId).toBe("string");
    expect(res.shops[0].gmvOpportunity).toBe(105_983_915);
    expect(res.shops[0].numCreators).toBe(1);
    expect(res.shops[1].numCreators).toBe(2);
    expect(res.shops[1].totalProductsPromoted).toBe(4);
  });

  it("missing sheet → empty result + note (optional file, never throws)", async () => {
    const file = artifactFile({ Something_Else: [["x"]] });
    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(0);
    expect(res.skipped[0]).toMatch(/BD_Shop_Summary/);
  });

  it("stops at the first blank shop-id row", async () => {
    const file = artifactFile({
      BD_Shop_Summary: [
        HEADER,
        ["1", "7496144953400855459", "ALV", "W", "B", "Rp100", "1", "1"],
        ["", "", "", "", "", "", "", ""],
        ["2", "7494515292378204243", "pj", "W", "B", "Rp200", "1", "1"],
      ],
    });
    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(1);
  });
});

// ============================================================================
// Format v2 (new generator export) — "MEA_Agency_Link_Detail_*.xlsx" /
// "MEA_BD_Opportunity_*.xlsx". Sheet layouts mirror the real files verified
// against ~/Downloads/MEA_Agency_Link_Detail_2026-06.xlsx and
// MEA_BD_Opportunity_2026-06.xlsx (row-for-row structure, anonymized values).
// ============================================================================

/** Builds an XLSX.WorkBook (not a File) for detectArtifactFormat unit tests. */
function workbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  }
  return wb;
}

/** Mirrors the real "Ringkasan Creator" sheet layout (File 1, format v2). */
function ringkasanCreatorSheet(periodLine: string, creators: Array<[string, string]>): unknown[][] {
  return [
    [periodLine],
    [""],
    ["Total Creator Affiliate GMV", "347,379,967"],
    ["Total TAP (Agency Link) GMV", "66,090,474"],
    ["Potential Leak (Partnered shops GMV not fully in TAP campaigns)", "185,764,946"],
    [""],
    ["Per Creator Summary"],
    ...creators.map(([name, gmv]) => [name, gmv]),
    [""],
    [""],
    ["Note: TAP file lacks per-creator breakdown. Potential leak estimated from partnered shop GMV in Creator report."],
  ];
}

const PRODUK_BOCOR_SHEET: unknown[][] = [
  ["Product ID", "Product Name", "Shop ID", "Shop Name", "Category", "GMV (Rp)"],
  ["1732739316382795045", "Some Product", "7495144160033868069", "Some Shop", "Fashion", "43,776,542"],
];

describe("detectArtifactFormat", () => {
  it("detects v2 by the 'Detail Report ... to ...' title row", () => {
    const wb = workbook({
      "Ringkasan Creator": ringkasanCreatorSheet(
        "MEA Agency Link Intelligence - Detail Report 2026-06-01 to 2026-06-07",
        [["bidanlilis77", "121,193,930"]]
      ),
      "Produk Bocor (Partnered Shops)": PRODUK_BOCOR_SHEET,
    });
    expect(detectArtifactFormat(wb)).toBe("v2");
  });

  it("detects v2 from the title row alone (missing 'Per Creator Summary' is a structural error for the v2 parser, not a format-detection miss)", () => {
    const wb = workbook({
      "Ringkasan Creator": [["Detail Report 2026-06-01 to 2026-06-07"], ["no per creator summary here"]],
    });
    expect(detectArtifactFormat(wb)).toBe("v2");
  });

  it("detects v1 by the '▶ CREATOR:' marker regardless of Period row", () => {
    const wb = workbook({
      "Executive Summary": [["UMA REPORT"], ["Period: 2026-06-01 to 2026-06-07 | Generated: x"]],
      Creator_Detail_Sections: [["H"], ["▶ CREATOR: alpha"], ["• Total Affiliate GMV: Rp100"]],
    });
    expect(detectArtifactFormat(wb)).toBe("v1");
  });

  it("returns null when neither fingerprint matches", () => {
    const wb = workbook({ RandomSheet: [["nothing", "here"]] });
    expect(detectArtifactFormat(wb)).toBeNull();
  });
});

describe("parseLeakDetailFile — format v2 (Ringkasan Creator / Produk Bocor)", () => {
  it("extracts period, CM-level totals, and per-creator affiliate GMV", async () => {
    const file = artifactFile({
      "Ringkasan Creator": ringkasanCreatorSheet(
        "MEA Agency Link Intelligence - Detail Report 2026-06-01 to 2026-06-07",
        [
          ["bidanlilis77", "121,193,930"],
          ["ivenameiliani", "120,434,118"],
          ["lenny_za", "95,033,127"],
        ]
      ),
      "Produk Bocor (Partnered Shops)": PRODUK_BOCOR_SHEET,
    });

    const res = await parseLeakDetailFile(file);
    expect(res.format).toBe("v2");
    expect(res.periodStart).toBe("2026-06-01");
    expect(res.periodEnd).toBe("2026-06-07");
    expect(res.weekTotals).toEqual({
      gmvAffiliateTotal: 347_379_967,
      gmvTap: 66_090_474,
      gmvLeakPotential: 185_764_946,
    });
    expect(res.creators).toHaveLength(3);
    expect(res.creators[0]).toEqual({
      creatorName: "bidanlilis77",
      gmvAffiliateTotal: 121_193_930,
      gmvTap: null,
      gmvBocor: null,
      bdOpportunityGmv: null,
      directGmv: null,
      effectiveness: null,
    });
    expect(res.skipped).toHaveLength(0);
  });

  it("real-file title format ('MEA Agency Link Intelligence - Detail Report ...') is recognized", async () => {
    // Regression guard for the exact title row text seen in the verified real
    // fixture (~/Downloads/MEA_Agency_Link_Detail_2026-06.xlsx row 0).
    const file = artifactFile({
      "Ringkasan Creator": ringkasanCreatorSheet(
        "MEA Agency Link Intelligence - Detail Report 2026-06-01 to 2026-06-07",
        [["_fearini_", "7,659,874"]]
      ),
      "Produk Bocor (Partnered Shops)": PRODUK_BOCOR_SHEET,
    });
    const res = await parseLeakDetailFile(file);
    expect(res.periodStart).toBe("2026-06-01");
    expect(res.creators[0].gmvAffiliateTotal).toBe(7_659_874);
  });

  it("missing a totals label → null + skipped note (never crash)", async () => {
    const sheet = [
      ["Detail Report 2026-06-01 to 2026-06-07"],
      ["Total Creator Affiliate GMV", "347,379,967"],
      // Total TAP row omitted.
      ["Potential Leak (Partnered shops GMV not fully in TAP campaigns)", "185,764,946"],
      ["Per Creator Summary"],
      ["alpha", "1,000,000"],
    ];
    const file = artifactFile({ "Ringkasan Creator": sheet });
    const res = await parseLeakDetailFile(file);
    expect(res.weekTotals?.gmvTap).toBeNull();
    expect(res.skipped.some((s) => s.includes("Total TAP"))).toBe(true);
  });

  it("throws a Bahasa Indonesia message when 'Per Creator Summary' is absent", async () => {
    const file = artifactFile({
      "Ringkasan Creator": [
        ["Detail Report 2026-06-01 to 2026-06-07"],
        ["Total Creator Affiliate GMV", "1,000"],
      ],
    });
    await expect(parseLeakDetailFile(file)).rejects.toThrow(/Per Creator Summary/);
  });

  it("format tak dikenali → actionable Bahasa Indonesia error listing found sheets", async () => {
    const file = artifactFile({ Sheet1: [["random", "data"]], Sheet2: [["more", "stuff"]] });
    await expect(parseLeakDetailFile(file)).rejects.toThrow(
      /Format file tidak dikenali.*Sheet1.*Sheet2/s
    );
  });
});

describe("parseBdOpportunityFile — format v2 (probed header, variable sheet name)", () => {
  const V2_HEADER = ["Shop ID", "Shop Name", "Level 1 Category", "Total GMV (Rp)", "Creators"];

  it("parses 'Ringkasan Shop Non-Partnered' (real sheet name) via content probing", async () => {
    const file = artifactFile({
      "Ringkasan Shop Non-Partnered": [
        ["BD Opportunity - Shop Belum Ada Kerjasama Agency (High GMV dari Creator)"],
        [""],
        V2_HEADER,
        ["7494200562129864069", "Atrium Suplemen Indonesia", "Health", "60,964,601", "bidanlilis77"],
        ["7496144953400855459", "ALV Jeans Premium", "Womenswear & Underwear", "26,672,225", "lenny_za,saniasantai"],
      ],
      "Detail Produk Creator per Shop": [
        ["Detail Produk & Creator untuk Shop Non-Partnered (Peluang BD)"],
        [""],
        ["Shop ID", "Shop Name", "Product ID", "Product Name", "Creator", "GMV (Rp)"],
        ["7494200562129864069", "Atrium Suplemen Indonesia", "173", "Some Product", "bidanlilis77", "1,000"],
      ],
    });

    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(2);
    expect(res.shops[0].shopId).toBe("7494200562129864069");
    expect(typeof res.shops[0].shopId).toBe("string");
    expect(res.shops[0].shopName).toBe("Atrium Suplemen Indonesia");
    expect(res.shops[0].level1Category).toBe("Health");
    expect(res.shops[0].gmvOpportunity).toBe(60_964_601);
    expect(res.shops[0].numCreators).toBe(1);
    expect(res.shops[0].level2Category).toBeNull();
    expect(res.shops[0].totalProductsPromoted).toBeNull();
    // Multi-creator comma list → count.
    expect(res.shops[1].numCreators).toBe(2);
  });

  it("detects the vikahere-variant sheet name 'Ringkasan Peluang BD Shops' by content, not name", async () => {
    const file = artifactFile({
      "Ringkasan Peluang BD Shops": [
        ["Some title row"],
        V2_HEADER,
        ["7496144953400855459", "ALV Jeans Premium", "Womenswear", "105,983,915", "alpha,beta,gamma"],
      ],
    });
    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(1);
    expect(res.shops[0].numCreators).toBe(3);
    expect(res.shops[0].gmvOpportunity).toBe(105_983_915);
  });

  it("ignores the per-product detail sheet (has 'Product ID' column) even if listed first", async () => {
    const file = artifactFile({
      "Detail Produk Creator per Shop": [
        ["Shop ID", "Shop Name", "Product ID", "Product Name", "Creator", "GMV (Rp)"],
        ["1", "Detail Shop", "999", "Some Product", "alpha", "1,000"],
      ],
      "Ringkasan Shop Non-Partnered": [V2_HEADER, ["2", "Summary Shop", "Health", "2,000", "beta"]],
    });
    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(1);
    expect(res.shops[0].shopId).toBe("2");
    expect(res.shops[0].shopName).toBe("Summary Shop");
  });

  it("stops at the first blank shop-id row (v2 header)", async () => {
    const file = artifactFile({
      "Ringkasan Shop Non-Partnered": [
        V2_HEADER,
        ["1", "A", "Health", "100", "x"],
        ["", "", "", "", ""],
        ["2", "B", "Health", "200", "y"],
      ],
    });
    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(1);
  });

  it("neither v1 nor v2 header found → empty result + Bahasa Indonesia note", async () => {
    const file = artifactFile({ SomethingElse: [["x", "y"]] });
    const res = await parseBdOpportunityFile(file);
    expect(res.shops).toHaveLength(0);
    expect(res.skipped[0]).toMatch(/BD_Shop_Summary/);
    expect(res.skipped[0]).toMatch(/Shop ID/);
  });
});

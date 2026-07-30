import { describe, expect, it, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";

/**
 * Orchestration tests for uploadLeakArtifact's FORMAT ROUTING (v1 vs v2). All
 * external dependencies (Supabase admin client, audit log, creator name
 * resolution, retention) are mocked so this test is isolated from the real DB
 * and from src/lib/ingest/run.ts (which only contributes enforceLeakRetention
 * here, mocked to a no-op — run.ts itself is out of scope / edited elsewhere).
 */

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}) as unknown,
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async () => {}),
}));

vi.mock("../run", () => ({
  enforceLeakRetention: vi.fn(async () => {}),
}));

vi.mock("@/lib/config", () => ({
  getConfig: vi.fn(async (key: string) => {
    if (key === "m4.bocor_sebagian") return 0.1;
    if (key === "m4.bocor_total") return 0.5;
    throw new Error(`unexpected config key ${key}`);
  }),
}));

const resolveCreatorNamesMock = vi.fn(async (_admin: unknown, names: string[]) => {
  const byName = new Map<string, string>();
  for (const n of names) byName.set(n.toLowerCase(), `CRT-${n.toLowerCase()}`);
  return { byName, unresolved: [] as string[] };
});
vi.mock("@/lib/platform-csv", () => ({
  resolveCreatorNames: (...args: unknown[]) =>
    (resolveCreatorNamesMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const writeLeakRollupsMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const writeUnknownLeakRollupsMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const writeLeakWeekSummaryMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const writeBdLeadsFromArtifactMock = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ created: 0, updated: 0 })
);
vi.mock("../leak-rollup", async () => {
  const actual = await vi.importActual<typeof import("../leak-rollup")>("../leak-rollup");
  return {
    ...actual,
    writeLeakRollups: (...args: unknown[]) => writeLeakRollupsMock(...args),
    writeUnknownLeakRollups: (...args: unknown[]) => writeUnknownLeakRollupsMock(...args),
    writeLeakWeekSummary: (...args: unknown[]) => writeLeakWeekSummaryMock(...args),
    writeBdLeadsFromArtifact: (...args: unknown[]) => writeBdLeadsFromArtifactMock(...args),
  };
});

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

function v1File(): File {
  return artifactFile({
    "Executive Summary": [["UMA REPORT"], ["Period: 2026-06-01 to 2026-06-07 | Generated: x"]],
    Creator_Detail_Sections: [
      ["H"],
      ["▶ CREATOR: alpha"],
      ["• Total Affiliate GMV: Rp1.000.000"],
      ["• Agency Link GMV (TAP): Rp900.000"],
      ["• Bocor (Leak): Rp100.000"],
      ["• Peluang BD (Non-Partnered Shops): Rp0"],
      ["• Direct GMV: Rp0"],
      ["• Agency Link Effectiveness: 90%"],
    ],
  });
}

function v2File(): File {
  return artifactFile({
    "Ringkasan Creator": [
      ["MEA Agency Link Intelligence - Detail Report 2026-06-01 to 2026-06-07"],
      [""],
      ["Total Creator Affiliate GMV", "347,379,967"],
      ["Total TAP (Agency Link) GMV", "66,090,474"],
      ["Potential Leak (Partnered shops GMV not fully in TAP campaigns)", "185,764,946"],
      [""],
      ["Per Creator Summary"],
      ["bidanlilis77", "121,193,930"],
      ["ivenameiliani", "120,434,118"],
      [""],
      ["Note: TAP file lacks per-creator breakdown."],
    ],
    "Produk Bocor (Partnered Shops)": [
      ["Product ID", "Product Name", "Shop ID", "Shop Name", "Category", "GMV (Rp)"],
    ],
  });
}

describe("uploadLeakArtifact — format routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCreatorNamesMock.mockImplementation(async (_admin: unknown, names: string[]) => {
      const byName = new Map<string, string>();
      for (const n of names) byName.set(n.toLowerCase(), `CRT-${n.toLowerCase()}`);
      return { byName, unresolved: [] as string[] };
    });
  });

  it("v1: recomputes full rollup via writeLeakRollups, status/ratio populated", async () => {
    const { uploadLeakArtifact } = await import("../leak-run");
    const result = await uploadLeakArtifact({ leakFile: v1File(), actorId: "actor-1" });

    expect(result.format).toBe("v1");
    expect(writeLeakRollupsMock).toHaveBeenCalledTimes(1);
    expect(writeUnknownLeakRollupsMock).not.toHaveBeenCalled();
    expect(result.creators).toHaveLength(1);
    expect(result.creators[0].linkStatus).toBe("via_agency");
    expect(result.creators[0].leakRatio).toBeCloseTo(0.1, 5);
    // v1 weekTotals are derived by summing per-creator bullets (single creator here).
    expect(result.weekTotals).toEqual({ gmvAffiliateTotal: 1_000_000, gmvTap: 900_000, gmvLeakPotential: 100_000 });
    expect(writeLeakWeekSummaryMock).toHaveBeenCalledWith(
      expect.anything(), "2026-06-01", "2026-06-07", result.weekTotals, "v1", "actor-1"
    );
  });

  it("v2: writes unknown rollup (status/ratio null), preserves CM-level totals from the sheet", async () => {
    const { uploadLeakArtifact } = await import("../leak-run");
    const result = await uploadLeakArtifact({ leakFile: v2File(), actorId: "actor-1" });

    expect(result.format).toBe("v2");
    expect(writeUnknownLeakRollupsMock).toHaveBeenCalledTimes(1);
    expect(writeLeakRollupsMock).not.toHaveBeenCalled();
    expect(result.creators).toHaveLength(2);
    for (const c of result.creators) {
      expect(c.linkStatus).toBeNull();
      expect(c.leakRatio).toBeNull();
      expect(c.gmvBocor).toBeNull();
      expect(c.gmvTap).toBeNull();
    }
    expect(result.creators.find((c) => c.creatorName === "bidanlilis77")?.gmvAffiliateTotal).toBe(121_193_930);
    expect(result.weekTotals).toEqual({
      gmvAffiliateTotal: 347_379_967,
      gmvTap: 66_090_474,
      gmvLeakPotential: 185_764_946,
    });
    expect(writeLeakWeekSummaryMock).toHaveBeenCalledWith(
      expect.anything(), "2026-06-01", "2026-06-07", result.weekTotals, "v2", "actor-1"
    );
    expect(result.skipped.some((s) => s.includes("tidak memiliki rincian bocor per kreator"))).toBe(true);
  });

  it("v2: W1-W5 gate still applies (rejects cross-month period)", async () => {
    const { uploadLeakArtifact } = await import("../leak-run");
    const file = artifactFile({
      "Ringkasan Creator": [
        ["Detail Report 2026-05-27 to 2026-06-23"],
        ["Total Creator Affiliate GMV", "1,000"],
        ["Total TAP (Agency Link) GMV", "1,000"],
        ["Potential Leak (Partnered shops GMV not fully in TAP campaigns)", "0"],
        ["Per Creator Summary"],
        ["alpha", "1,000"],
      ],
    });
    await expect(uploadLeakArtifact({ leakFile: file, actorId: "actor-1" })).rejects.toThrow(
      /W1-W5/
    );
    expect(writeUnknownLeakRollupsMock).not.toHaveBeenCalled();
  });

  it("format tak dikenali propagates as a thrown error with the sheet list", async () => {
    const { uploadLeakArtifact } = await import("../leak-run");
    const file = artifactFile({ Sheet1: [["x"]], Sheet2: [["y"]] });
    await expect(uploadLeakArtifact({ leakFile: file, actorId: "actor-1" })).rejects.toThrow(
      /Format file tidak dikenali/
    );
  });
});

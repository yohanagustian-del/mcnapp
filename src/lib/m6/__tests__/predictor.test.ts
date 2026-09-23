import { describe, expect, it } from "vitest";
import {
  averageRoas,
  buildCsvExport,
  buildTableExport,
  buildTextExport,
  compute,
  type CreatorPoolRow,
  type PoolModelConfig,
  type PredictorInput,
} from "../predictor";

// Nilai persis seed migrasi 0067 app_config `m6.pool_model`.
const CONFIG: PoolModelConfig = {
  rampDefault: 0.7,
  spreadBase: 0.45,
  spreadPerCreator: 0.02,
  spreadRoasFactor: 0.012,
  spreadMin: 0.12,
  spreadMax: 0.45,
  confidencePerCreator: 9,
  confidenceRoasFactor: 1.6,
  confidenceRoasBase: 6,
  confidenceRoasCap: 20,
  confidenceLowMax: 40,
  confidenceMediumMax: 70,
  roasBenchmarkPct: 8,
};

function baseInput(overrides: Partial<PredictorInput> = {}): PredictorInput {
  return {
    dealType: "tap",
    selectedCreatorGmv: [10_000_000, 20_000_000, 0], // hist=30jt, withHist=2
    anchor: 0,
    ramp: 0.7,
    roas: 0,
    budget: 0,
    ...overrides,
  };
}

describe("compute — deal tap, tanpa ads", () => {
  it("organic = hist × ramp; likely = organic (adUpside 0)", () => {
    const r = compute(baseInput(), CONFIG);
    expect(r.hist).toBe(30_000_000);
    expect(r.withHist).toBe(2);
    expect(r.organic).toBeCloseTo(21_000_000); // 30jt * 0.7
    expect(r.adUpside).toBe(0);
    expect(r.likely).toBeCloseTo(21_000_000);
  });

  it("spread = clamp(0.45 - withHist*0.02 - 0, 0.12, 0.45)", () => {
    const r = compute(baseInput(), CONFIG);
    // 0.45 - 2*0.02 = 0.41
    expect(r.spread).toBeCloseTo(0.41);
    expect(r.conservative).toBeCloseTo(21_000_000 * (1 - 0.41));
    expect(r.optimistic).toBeCloseTo(21_000_000 * (1 + 0.41));
  });

  it("confidence = min(100, round(withHist*9)) tanpa roas", () => {
    const r = compute(baseInput(), CONFIG);
    expect(r.confidence).toBe(18); // 2*9
    expect(r.confidenceLabel).toBe("Rendah"); // < 40
  });
});

describe("compute — deal non-tap (paid) dengan anchor", () => {
  it("organic = 0.5*hist*ramp + 0.5*anchor saat anchor>0", () => {
    const r = compute(baseInput({ dealType: "paid", anchor: 50_000_000 }), CONFIG);
    // 0.5*30jt*0.7 + 0.5*50jt = 10.5jt + 25jt = 35.5jt
    expect(r.organic).toBeCloseTo(35_500_000);
  });

  it("organic = hist saat non-tap tanpa anchor", () => {
    const r = compute(baseInput({ dealType: "paid", anchor: 0 }), CONFIG);
    expect(r.organic).toBeCloseTo(30_000_000);
  });
});

describe("compute — dengan ROAS & budget (ads upside)", () => {
  it("adUpside = roas × budget; spread & confidence terpengaruh roas", () => {
    const r = compute(baseInput({ roas: 10, budget: 1_000_000 }), CONFIG);
    expect(r.adUpside).toBe(10_000_000);
    expect(r.likely).toBeCloseTo(21_000_000 + 10_000_000);

    // spread: 0.45 - 2*0.02 - (10-8)*0.012 = 0.45 - 0.04 - 0.024 = 0.386
    expect(r.spread).toBeCloseTo(0.386);

    // confidence: withHist*9 + min(roas,20)*1.6 + 6 = 18 + 16 + 6 = 40 -> Sedang
    expect(r.confidence).toBe(40);
    expect(r.confidenceLabel).toBe("Sedang");
  });

  it("roas tinggi men-clamp confidenceRoasCap", () => {
    const r = compute(baseInput({ roas: 50, budget: 1 }), CONFIG);
    // min(50,20)*1.6 + 6 = 32 + 6 = 38; + withHist*9=18 => 56
    expect(r.confidence).toBe(56);
  });

  it("adUpside 0 bila salah satu dari roas/budget kosong", () => {
    expect(compute(baseInput({ roas: 10, budget: 0 }), CONFIG).adUpside).toBe(0);
    expect(compute(baseInput({ roas: 0, budget: 1_000_000 }), CONFIG).adUpside).toBe(0);
  });
});

describe("compute — edge cases", () => {
  it("confidence 0 saat likely <= 0", () => {
    const r = compute(baseInput({ selectedCreatorGmv: [], ramp: 0.7 }), CONFIG);
    expect(r.likely).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.confidenceLabel).toBe("Rendah");
  });

  it("spread di-clamp ke spreadMax/spreadMin", () => {
    // withHist besar & roas tinggi mendorong spread negatif -> clamp ke spreadMin
    const many = Array.from({ length: 30 }, () => 1_000_000);
    const r = compute(baseInput({ selectedCreatorGmv: many, roas: 20 }), CONFIG);
    expect(r.spread).toBe(CONFIG.spreadMin);
  });

  it("label confidence: Rendah <40, Sedang <70, Tinggi >=70", () => {
    expect(compute(baseInput({ selectedCreatorGmv: [1_000_000] }), CONFIG).confidenceLabel).toBe("Rendah");
    const sedang = compute(baseInput({ roas: 10, budget: 1_000_000 }), CONFIG);
    expect(sedang.confidenceLabel).toBe("Sedang");
    const many = Array.from({ length: 10 }, () => 1_000_000);
    const tinggi = compute(baseInput({ selectedCreatorGmv: many, roas: 15, budget: 1_000_000 }), CONFIG);
    expect(tinggi.confidenceLabel).toBe("Tinggi");
  });
});

describe("averageRoas", () => {
  it("rata-rata hanya baris roas > 0", () => {
    expect(averageRoas([10, 0, 20, null, undefined, -5])).toBe(15);
  });
  it("null bila tidak ada baris positif", () => {
    expect(averageRoas([0, null, undefined])).toBeNull();
  });
});

describe("export builders", () => {
  const rows: CreatorPoolRow[] = [
    { creatorId: "CRT-1", username: "kreator1", gmvCell: 10_000_000, orders: 5, liveShare: 0.6, roasRef: 8.5 },
    { creatorId: "CRT-2", username: "kreator,2", gmvCell: 2_500_000, orders: 1, liveShare: null, roasRef: null },
  ];

  it("buildTextExport: satu baris per kreator", () => {
    const text = buildTextExport(rows);
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("kreator1");
    expect(text).toContain("60.0%");
  });

  it("buildTableExport: TSV dengan header", () => {
    const table = buildTableExport(rows);
    const lines = table.split("\n");
    expect(lines[0]).toBe("Username\tGMV Sel\tOrder\t% Live\tROAS Ref");
    expect(lines[1]).toContain("\t");
  });

  it("buildCsvExport: quote field yang mengandung koma", () => {
    const csv = buildCsvExport(rows);
    expect(csv).toContain('"kreator,2"');
  });
});

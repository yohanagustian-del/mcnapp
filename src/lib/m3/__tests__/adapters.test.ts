import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bindingCount,
  bindingHbfCount,
  bindingCommissionGte20,
  externalApproachCount,
  externalConversionPct,
  gmvPortfolioTotal,
  levelUpCount,
  specialProjectPct,
  getActualForMetric,
  getHandsOnRatio,
} from "../adapters";

// ─── Mock Supabase: chainable + thenable, hasil per tabel ───────────────────
// Tiap .from(table) mengembalikan builder yang meneruskan semua chain
// (.select/.eq/.gte/.lte/.lt/.in/.order/.limit) dan resolve ke hasil tabel.
type MockResult = { data?: unknown; count?: number };

function makeQuery(result: MockResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "gte", "lte", "lt", "in", "order", "limit"]) {
    builder[m] = chain;
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.single = () => Promise.resolve(result);
  builder.then = (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabase(resultsByTable: Record<string, MockResult>): SupabaseClient {
  return {
    from: (table: string) => makeQuery(resultsByTable[table] ?? { data: [], count: 0 }),
  } as unknown as SupabaseClient;
}

const PERIOD = "2026-07-01";
const SUBJECT = "TM-001";

describe("bindingCount (M8 acquisitions)", () => {
  it("meneruskan count dari query", async () => {
    const sb = mockSupabase({ acquisitions: { count: 7 } });
    const r = await bindingCount(sb, SUBJECT, PERIOD);
    expect(r.value).toBe(7);
    expect(r.sourceRef).toContain("acquisitions");
  });

  it("count null → 0 (guard)", async () => {
    const sb = mockSupabase({ acquisitions: { count: undefined } });
    expect((await bindingCount(sb, SUBJECT, PERIOD)).value).toBe(0);
  });
});

describe("bindingHbfCount (acquisitions + creators, niche HBF & LS4/65jt)", () => {
  it("hanya hitung creator HBF yang eligible (level≥4 ATAU gmv≥65jt)", async () => {
    const sb = mockSupabase({
      acquisitions: {
        data: [
          { creator_id: "CRT-1", creators: { level: 4, gmv: 10_000_000, niche: "beauty" } },   // eligible level
          { creator_id: "CRT-2", creators: { level: 2, gmv: 70_000_000, niche: "fashion" } },   // eligible gmv
          { creator_id: "CRT-3", creators: { level: 2, gmv: 10_000_000, niche: "health" } },     // niche ok, tak eligible
          { creator_id: "CRT-4", creators: { level: 5, gmv: 90_000_000, niche: "gaming" } },      // eligible tapi bukan HBF
          { creator_id: "CRT-5", creators: { level: 4, gmv: 0, niche: "Kecantikan" } },           // niche indo + level ok
        ],
      },
    });
    const r = await bindingHbfCount(sb, SUBJECT, PERIOD);
    expect(r.value).toBe(3); // CRT-1, CRT-2, CRT-5
  });

  it("data kosong → 0", async () => {
    const sb = mockSupabase({ acquisitions: { data: [] } });
    expect((await bindingHbfCount(sb, SUBJECT, PERIOD)).value).toBe(0);
  });
});

describe("bindingCommissionGte20 (komisi ≥ 20%)", () => {
  it("hitung creator dengan commission_share ≥ 0.20", async () => {
    const sb = mockSupabase({
      acquisitions: {
        data: [
          { creator_id: "CRT-1", creators: { commission_share: 0.20 } }, // batas tepat
          { creator_id: "CRT-2", creators: { commission_share: 0.35 } },
          { creator_id: "CRT-3", creators: { commission_share: 0.19 } }, // di bawah
          { creator_id: "CRT-4", creators: { commission_share: null } },  // null → 0
        ],
      },
    });
    expect((await bindingCommissionGte20(sb, SUBJECT, PERIOD)).value).toBe(2);
  });
});

describe("externalApproachCount (M8 external_approaches)", () => {
  it("meneruskan count", async () => {
    const sb = mockSupabase({ external_approaches: { count: 12 } });
    expect((await externalApproachCount(sb, SUBJECT, PERIOD)).value).toBe(12);
  });
});

describe("externalConversionPct (rasio pakai_link / total)", () => {
  it("hitung rasio konversi", async () => {
    const sb = mockSupabase({
      external_approaches: {
        data: [
          { status: "pakai_link" },
          { status: "pakai_link" },
          { status: "ditolak" },
          { status: "pending" },
        ],
      },
    });
    expect((await externalConversionPct(sb, SUBJECT, PERIOD)).value).toBeCloseTo(0.5);
  });

  it("tidak ada approach → 0 (bukan NaN)", async () => {
    const sb = mockSupabase({ external_approaches: { data: [] } });
    expect((await externalConversionPct(sb, SUBJECT, PERIOD)).value).toBe(0);
  });
});

describe("gmvPortfolioTotal (Module 0.5 Fase 2 — creator_period_summary via creators owner_cpm_id)", () => {
  it("jumlahkan GMV semua creator milik CPM", async () => {
    const sb = mockSupabase({
      creators: { data: [{ id: "CRT-1" }, { id: "CRT-2" }] },
      creator_period_summary: {
        data: [{ affiliate_gmv: 1_000_000 }, { affiliate_gmv: 2_500_000 }, { affiliate_gmv: 500_000 }],
      },
    });
    expect((await gmvPortfolioTotal(sb, SUBJECT, PERIOD)).value).toBe(4_000_000);
  });

  it("CPM tanpa creator → 0", async () => {
    const sb = mockSupabase({ creators: { data: [] } });
    expect((await gmvPortfolioTotal(sb, SUBJECT, PERIOD)).value).toBe(0);
  });
});

describe("levelUpCount (creators.level vs okr_snapshots baseline)", () => {
  it("hitung creator yang naik level dibanding baseline", async () => {
    const sb = mockSupabase({
      okr_snapshots: {
        data: { payload: { creator_levels: { "CRT-1": 3, "CRT-2": 4, "CRT-3": 2 } } },
      },
      creators: {
        data: [
          { id: "CRT-1", level: 4 }, // naik
          { id: "CRT-2", level: 4 }, // tetap
          { id: "CRT-3", level: 5 }, // naik
        ],
      },
    });
    expect((await levelUpCount(sb, SUBJECT, PERIOD)).value).toBe(2);
  });

  it("belum ada baseline snapshot → 0 (graceful)", async () => {
    const sb = mockSupabase({ okr_snapshots: { data: null } });
    const r = await levelUpCount(sb, SUBJECT, PERIOD);
    expect(r.value).toBe(0);
    expect(r.sourceRef).toContain("belum ada baseline");
  });
});

describe("specialProjectPct (M7 special_projects.result_summary)", () => {
  it("rata-rata fulfillment_pct langsung", async () => {
    const sb = mockSupabase({
      special_projects: {
        data: [
          { status: "selesai", result_summary: { fulfillment_pct: 0.8 } },
          { status: "selesai", result_summary: { fulfillment_pct: 1.0 } },
        ],
      },
    });
    expect((await specialProjectPct(sb)).value).toBeCloseTo(0.9);
  });

  it("bentuk fulfilled/total dikonversi ke rasio", async () => {
    const sb = mockSupabase({
      special_projects: {
        data: [{ status: "selesai", result_summary: { fulfilled: 3, total: 4 } }],
      },
    });
    expect((await specialProjectPct(sb)).value).toBeCloseTo(0.75);
  });

  it("tidak ada project selesai → 0", async () => {
    const sb = mockSupabase({ special_projects: { data: [] } });
    expect((await specialProjectPct(sb)).value).toBe(0);
  });
});

describe("getActualForMetric (dispatcher)", () => {
  it("route ke adapter yang benar", async () => {
    const sb = mockSupabase({ acquisitions: { count: 3 } });
    const r = await getActualForMetric(sb, "binding_count", SUBJECT, PERIOD, null);
    expect(r?.value).toBe(3);
  });

  it("metric tak dikenal → null (belum diimplementasi)", async () => {
    const sb = mockSupabase({});
    expect(await getActualForMetric(sb, "metric_ngawur", SUBJECT, PERIOD, null)).toBeNull();
  });
});

describe("getHandsOnRatio (korelasional: GMV naik × aktivitas CPM)", () => {
  it("rasio GMV naik pada creator dengan aktivitas tercatat", async () => {
    const sb = mockSupabase({
      creators: {
        data: [
          { id: "CRT-1", gmv: 3_000_000 }, // naik dari 1jt = +2jt, ada aktivitas
          { id: "CRT-2", gmv: 2_000_000 }, // naik dari 1jt = +1jt, TANPA aktivitas
        ],
      },
      creator_period_summary: {
        data: [
          { creator_id: "CRT-1", affiliate_gmv: 1_000_000, period_start: "2026-06-01" },
          { creator_id: "CRT-2", affiliate_gmv: 1_000_000, period_start: "2026-06-01" },
        ],
      },
      creator_requests: { data: [{ creator_id: "CRT-1" }] }, // aktivitas hanya CRT-1
      cpm_report_activity: { data: [] },
      campaign_requests: { data: [] },
    });
    const ratio = await getHandsOnRatio(sb, SUBJECT, 7);
    // hands-on = 2jt (CRT-1) / total naik 3jt = 0.667
    expect(ratio).toBeCloseTo(2_000_000 / 3_000_000);
  });

  it("CPM tanpa creator → null", async () => {
    const sb = mockSupabase({ creators: { data: [] } });
    expect(await getHandsOnRatio(sb, SUBJECT, 7)).toBeNull();
  });
});

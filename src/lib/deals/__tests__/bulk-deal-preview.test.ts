import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBulkDealMatrix, readSheetMatrix } from "../bulk-deal-spec";
import { planBulkDeals, type ExistingDeal } from "../bulk-deal-plan";
import { dealsAsParsed, PROD_SNAPSHOT, toRunLog } from "../bulk-deal-preview";
import { DEFAULT_ADS_SUPPORT_OPTIONS, DEFAULT_LEADS_TYPE_OPTIONS, DEFAULT_NICHE_OPTIONS } from "../deal-options";

const options = { adsSupport: DEFAULT_ADS_SUPPORT_OPTIONS, leadsType: DEFAULT_LEADS_TYPE_OPTIONS, niche: DEFAULT_NICHE_OPTIONS, fromDefaults: true };
const parsed = parseBulkDealMatrix(readSheetMatrix(readFileSync(join(__dirname, "fixtures/bulk-deal-sample.csv"), "utf8"), "x.csv"));
const base = { members: [], bizdevRoles: ["bizdev"], projectShopIds: new Set<string>(), options };

describe("preview: baris tersimpan dibaca balik sebagai sheet", () => {
  it("hasil load dibandingkan dengan dirinya sendiri = tidak ada perubahan", () => {
    const first = planBulkDeals({ ...base, parsed, existing: [] });
    const stored: ExistingDeal[] = first.inserts.map((p, i) => ({ id: `D${i}`, platform: "tiktok", ...p.record }) as ExistingDeal);
    const again = planBulkDeals({ ...base, parsed: dealsAsParsed(stored), existing: stored });
    expect(again.inserts).toEqual([]);
    expect(again.updates.map((u) => u.diffs)).toEqual([]);
    expect(again.unchanged).toHaveLength(stored.length);
  });

  it("snapshot produksi ter-bundle (48 baris, tanpa nilai kontak)", () => {
    expect(PROD_SNAPSHOT.deals).toHaveLength(48);
    for (const d of PROD_SNAPSHOT.deals) {
      expect([null, undefined, "(ada)"]).toContain(d.contact_pic_brand);
    }
  });

  it("log run tidak memuat baris insert/update (ringkas)", () => {
    const log = toRunLog(planBulkDeals({ ...base, parsed, existing: [] }));
    expect(log).not.toHaveProperty("inserts");
    expect(log.counts.inserts).toBe(parsed.rows.length);
    expect(log.skipped.length).toBe(parsed.skipped.length);
  });
});

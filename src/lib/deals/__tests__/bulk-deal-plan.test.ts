import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBulkDealMatrix, readSheetMatrix } from "../bulk-deal-spec";
import { matchMemberName, planBulkDeals, type TeamMemberLite } from "../bulk-deal-plan";
import { DEFAULT_ADS_SUPPORT_OPTIONS, DEFAULT_LEADS_TYPE_OPTIONS, DEFAULT_NICHE_OPTIONS } from "../deal-options";

const parsed = parseBulkDealMatrix(
  readSheetMatrix(readFileSync(join(__dirname, "fixtures/bulk-deal-sample.csv"), "utf8"), "x.csv")
);
const members: TeamMemberLite[] = [
  { id: "m-alya", name: "Alya", role: "bizdev", active: true },
  { id: "m-laila", name: "Laila S", role: "bizdev", active: true },
  { id: "m-dania", name: "Dania Tiffany", role: "bizdev", active: true },
  { id: "m-erlina", name: "Erlina sri utami", role: "bizdev", active: true },
  { id: "m-yaumal", name: "M Yaumal Mizan Firdaus", role: "bizdev", active: true },
  { id: "m-fanny", name: "Fanny Putri Fernanda", role: "bizdev", active: true },
  { id: "m-diena", name: "Diena Shofwah", role: "campaign_ops", active: true },
];
const options = {
  adsSupport: DEFAULT_ADS_SUPPORT_OPTIONS, leadsType: DEFAULT_LEADS_TYPE_OPTIONS,
  niche: DEFAULT_NICHE_OPTIONS, fromDefaults: true,
};
const plan = planBulkDeals({
  parsed,
  existing: [
    { id: "DEAL-1", platform: "tiktok", brand_name: "20Mefree", shop_id: "7494972658027039598", status: "running", niche: "Health" },
    { id: "DEAL-2", platform: "tiktok", brand_name: "Brand Lama", shop_id: "1", status: "done" },
    { id: "DEAL-3", platform: "shopee", brand_name: "Toko Shopee", shop_id: "2" },
  ],
  members,
  bizdevRoles: ["bizdev_lead", "bizdev", "campaign_ops", "bd_admin"],
  projectShopIds: new Set(["7494033681309861696"]),
  options,
});

describe("planBulkDeals", () => {
  it("upsert per kunci (platform, shop_id, brand_name); diff per field", () => {
    const upd = plan.updates.find((u) => u.existingId === "DEAL-1")!;
    expect(upd.diffs.map((d) => d.field)).toContain("niche");
    // status lama 'running' vs sheet 'Reguler' = beda; nilai lama dinormalisasi dulu.
    expect(upd.diffs.find((d) => d.field === "status")).toMatchObject({ before: "running", after: "reguler" });
    expect(plan.inserts.length + plan.updates.length + plan.unchanged.length).toBe(parsed.rows.length);
  });

  it("baris environment yang tidak ada di sheet = kandidat soft-deactivate (Shopee tidak ikut)", () => {
    expect(plan.missingFromSheet.map((m) => m.id)).toEqual(["DEAL-2"]);
  });

  it("alias yang dikonfirmasi: 'Fanny' → Fanny Putri Fernanda, handler shop ikut ditulis (D-2026-10-21-1)", () => {
    const fanny = plan.bizdevNames.find((n) => n.name === "Fanny")!;
    expect(fanny.memberId).toBe("m-fanny");
    const shop = plan.handlers.find((h) => h.brands.includes("Bintang leather"))!;
    expect(shop.unmatched).toEqual([]);
    expect(shop.memberIds).toContain("m-fanny");
  });

  it("alias yang dikonfirmasi: Campaign Ops 'Diena' → Diena Shofwah", () => {
    expect(plan.campaignOpsNames.find((n) => n.name === "Diena")!.memberId).toBe("m-diena");
  });

  it("Ads Brand: di luar daftar dilaporkan; brand tanpa Project BD masuk 'perlu dipasang'", () => {
    expect(plan.adsOutOfList).toHaveLength(6);
    expect(plan.adsNeedsProject.every((a) => a.shopId !== "7494033681309861696")).toBe(true);
    expect(plan.adsNeedsProject.length).toBeGreaterThan(0);
  });

  it("niche kosong dilaporkan; ejaan niche tidak digabung (D-2026-10-21-3)", () => {
    expect(plan.nicheEmpty.map((n) => n.brandName).sort()).toEqual(["Amarome.Naturals", "Cottonela.idn"]);
    expect(plan.nicheMergeProposals).toEqual([]);
    expect(plan.inserts.some((i) => i.record.niche === "Mom & baby")).toBe(true);
  });

  it("matchMemberName tidak peka huruf besar/kecil tapi tidak menebak", () => {
    expect(matchMemberName("alya ", members).memberId).toBe("m-alya");
    expect(matchMemberName("Lala", members).memberId).toBeNull();
  });

  it("alias yang dikonfirmasi (Fanny, Diena) dipetakan ke nama lengkap", () => {
    const team = [
      { id: "m-fanny", name: "Fanny Putri Fernanda", role: "bizdev", active: true },
      { id: "m-diena", name: "Diena Shofwah", role: "campaign_ops", active: true },
    ];
    expect(matchMemberName("Fanny", team, ["bizdev"]).memberId).toBe("m-fanny");
    expect(matchMemberName(" diena ", team).memberId).toBe("m-diena");
  });
});

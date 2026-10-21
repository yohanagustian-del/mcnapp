import type { SupabaseClient } from "@supabase/supabase-js";
import { BIZDEV_ROLES } from "@/lib/rbac-constants";
import { parseBizdev, parseSupportTypes, type BulkDealParseResult, type BulkDealRow } from "./bulk-deal-spec";
import { normalizeDealStatus } from "./deal-status";
import { planBulkDeals, SENSITIVE_FIELDS, type BulkDealPlan, type ExistingDeal, type TeamMemberLite } from "./bulk-deal-plan";
import { loadExistingDeals } from "./bulk-deal-load";
import { DEFAULT_ADS_SUPPORT_OPTIONS, DEFAULT_LEADS_TYPE_OPTIONS, DEFAULT_NICHE_OPTIONS } from "./deal-options";
import prodSnapshot from "./data/prod-snapshot-2026-10-20.json";

/**
 * Halaman Preview Bulk Load (/deals/import/preview, keputusan Yohan 2026-10-20 19:06):
 * hasil load sheet di environment ini (staging) dibandingkan dengan produksi.
 *
 * Produksi TIDAK dibaca dari aplikasi staging (staging tidak memegang kredensial
 * produksi): pembandingnya = snapshot SELECT read-only produksi yang di-commit
 * (src/lib/deals/data/prod-snapshot-*.json, dibuat ulang dengan
 * scripts/mcn-bulkload-dryrun.ts --live). Daftar "perlu konfirmasi tim" berasal dari
 * log run import terakhir di audit_logs (action BULK_RUN_ACTION).
 */

export const BULK_RUN_ACTION = "brand_deal.bulk_import_run";

/** Bagian BulkDealPlan yang disimpan di log run (tanpa baris insert/update/unchanged). */
export type BulkRunLog = Pick<
  BulkDealPlan,
  | "skipped" | "handlers" | "bizdevNames" | "campaignOpsNames" | "statusNull" | "adsOutOfList"
  | "adsNeedsProject" | "leadsOutOfList" | "nicheOutOfList" | "nicheEmpty" | "nicheMergeProposals" | "warnings"
> & { counts: { inserts: number; updates: number; unchanged: number; skipped: number; missing: number } };

export function toRunLog(plan: BulkDealPlan): BulkRunLog {
  return {
    skipped: plan.skipped,
    handlers: plan.handlers.filter((h) => !h.apply),
    bizdevNames: plan.bizdevNames,
    campaignOpsNames: plan.campaignOpsNames,
    statusNull: plan.statusNull,
    adsOutOfList: plan.adsOutOfList,
    adsNeedsProject: plan.adsNeedsProject,
    leadsOutOfList: plan.leadsOutOfList,
    nicheOutOfList: plan.nicheOutOfList,
    nicheEmpty: plan.nicheEmpty,
    nicheMergeProposals: plan.nicheMergeProposals,
    warnings: plan.warnings,
    counts: {
      inserts: plan.inserts.length,
      updates: plan.updates.length,
      unchanged: plan.unchanged.length,
      skipped: plan.skipped.length,
      missing: plan.missingFromSheet.length,
    },
  };
}

export interface ProdSnapshot {
  env: string;
  fetchedAt: string;
  deals: ExistingDeal[];
  refs: Record<string, Record<string, number>>;
  members: TeamMemberLite[];
  projectShopIds: string[];
  handlers: Record<string, string[]>;
}

export const PROD_SNAPSHOT = prodSnapshot as unknown as ProdSnapshot;

/** Baris brand_deals environment ini → bentuk "sheet" supaya bisa dibandingkan dengan produksi. */
export function dealsAsParsed(deals: ExistingDeal[]): BulkDealParseResult {
  const rows: BulkDealRow[] = deals
    .filter((d) => (d.platform ?? "tiktok") === "tiktok" && !d.deactivated_at && d.shop_id)
    .map((d) => {
      const s = (k: keyof ExistingDeal) => (d[k] === null || d[k] === undefined ? null : String(d[k]));
      const n = (k: keyof ExistingDeal) => (d[k] === null || d[k] === undefined ? null : Number(d[k]));
      const support = Array.isArray(d.support_types) ? (d.support_types as string[]).join(",") : "";
      return {
        sheetRow: 0,
        brandName: d.brand_name,
        shopId: d.shop_id!,
        bizdevLabel: s("bizdev_label"),
        bizdevNames: parseBizdev(s("bizdev_label") ?? "").names,
        statusRaw: s("status") ?? "",
        status: normalizeDealStatus(s("status")),
        niche: s("niche"),
        brandLink: s("brand_link"),
        contactPic: s("contact_pic_brand"),
        namaGrup: s("nama_grup"),
        gmvTap: n("gmv_tap"),
        avgPrice: n("avg_price"),
        supportTypes: parseSupportTypes(support.replace(/_/g, " ")).types,
        adsBrand: s("ads_brand"),
        leadsType: s("leads_type"),
        priority: s("priority"),
        workingSheet: s("working_sheet"),
        campaignOpsName: null,
        campaignName: s("campaign_name"),
        campaignId: s("campaign_id"),
        expDate: s("exp_date"),
        shopCode: s("shop_code"),
        extraNote: null,
        warnings: [],
      };
    });
  return { rows, skipped: [], errors: [], headerRow: 0 };
}

export interface PreviewData {
  /** Diff produksi (snapshot) → environment ini, digabung dengan daftar konfirmasi run terakhir. */
  plan: BulkDealPlan;
  envRowCount: number;
  lastRun: { at: string; by: string | null; counts: BulkRunLog["counts"] } | null;
  snapshot: ProdSnapshot;
}

export async function loadPreviewData(client: SupabaseClient): Promise<PreviewData> {
  const envDeals = await loadExistingDeals(client);
  const diff = planBulkDeals({
    parsed: dealsAsParsed(envDeals),
    existing: PROD_SNAPSHOT.deals,
    members: PROD_SNAPSHOT.members,
    bizdevRoles: BIZDEV_ROLES,
    projectShopIds: new Set(PROD_SNAPSHOT.projectShopIds),
    options: {
      adsSupport: DEFAULT_ADS_SUPPORT_OPTIONS,
      leadsType: DEFAULT_LEADS_TYPE_OPTIONS,
      niche: DEFAULT_NICHE_OPTIONS,
      fromDefaults: true,
    },
  });
  // campaign_ops_id beda environment (uuid staging ≠ produksi) → bukan perbedaan data;
  // kontak di snapshot hanya "(ada)" → yang dibandingkan hanya ada/tidaknya.
  const filled = (v: unknown) => v !== null && v !== undefined && v !== "";
  for (const u of diff.updates) {
    u.diffs = u.diffs.filter(
      (d) => d.field !== "campaign_ops_id" && !(SENSITIVE_FIELDS.includes(d.field) && filled(d.before) === filled(d.after))
    );
  }
  const updates = diff.updates.filter((u) => u.diffs.length > 0);
  const unchanged = [...diff.unchanged, ...diff.updates.filter((u) => u.diffs.length === 0)];

  const { data: runs } = await client
    .from("audit_logs")
    .select("created_at, after, team_members(name)")
    .eq("action", BULK_RUN_ACTION)
    .order("created_at", { ascending: false })
    .limit(1);
  const run = runs?.[0];
  const log = (run?.after ?? null) as BulkRunLog | null;

  const plan: BulkDealPlan = {
    ...diff,
    updates,
    unchanged,
    skipped: log?.skipped ?? [],
    handlers: log?.handlers ?? [],
    bizdevNames: log?.bizdevNames ?? [],
    campaignOpsNames: log?.campaignOpsNames ?? [],
    statusNull: log?.statusNull ?? [],
    adsOutOfList: log?.adsOutOfList ?? [],
    adsNeedsProject: log?.adsNeedsProject ?? [],
    leadsOutOfList: log?.leadsOutOfList ?? [],
    nicheOutOfList: log?.nicheOutOfList ?? [],
    nicheEmpty: log?.nicheEmpty ?? [],
    nicheMergeProposals: log?.nicheMergeProposals ?? [],
    warnings: log?.warnings ?? [],
  };
  return {
    plan,
    envRowCount: envDeals.length,
    lastRun: run
      ? {
          at: run.created_at as string,
          by: (run.team_members as unknown as { name?: string } | null)?.name ?? null,
          counts: log!.counts,
        }
      : null,
    snapshot: PROD_SNAPSHOT,
  };
}

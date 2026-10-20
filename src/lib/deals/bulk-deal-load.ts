import type { SupabaseClient } from "@supabase/supabase-js";
import { BIZDEV_ROLES } from "@/lib/rbac-constants";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { MIGRATION_0097_MISSING } from "@/lib/db/missing-migration";
import type { BulkDealParseResult } from "./bulk-deal-spec";
import { BULK_PLATFORM, planBulkDeals, type BulkDealPlan, type ExistingDeal, type TeamMemberLite } from "./bulk-deal-plan";
import { loadDealOptions } from "./deal-options";

/**
 * Data environment (brand_deals, anggota tim, Project BD) untuk planBulkDeals — dipakai
 * Import Bulk Deal Brand dan halaman preview. Server-only (client service role).
 */

export const BULK_SELECT_COLS =
  "id, platform, brand_name, shop_id, bizdev_label, status, niche, brand_link, contact_pic_brand, nama_grup, gmv_tap, avg_price, support_types, ads_brand, leads_type, priority, working_sheet, campaign_ops_id, campaign_name, campaign_id, exp_date, shop_code, deactivated_at";

export interface PlanContext {
  plan: BulkDealPlan;
  envRowCount: number;
}

export async function loadExistingDeals(client: SupabaseClient, columns = BULK_SELECT_COLS): Promise<ExistingDeal[]> {
  try {
    return await fetchAll<ExistingDeal>(client, "brand_deals", columns, (q) => q.order("id"));
  } catch (e) {
    // Kolom 0097 belum ada di environment ini → pesan jelas, bukan crash.
    if (/does not exist|schema cache/i.test(e instanceof Error ? e.message : "")) throw new Error(MIGRATION_0097_MISSING);
    throw e;
  }
}

export async function loadPlanContext(client: SupabaseClient, parsed: BulkDealParseResult): Promise<PlanContext> {
  const existing = await loadExistingDeals(client);
  const [{ data: members }, { data: map }, { data: projShops }] = await Promise.all([
    client.from("team_members").select("id, name, role, active"),
    client.from("shop_key_map").select("shop_id, shop_key").eq("platform", BULK_PLATFORM),
    client.from("bd_project_shops").select("shop_key"),
  ]);
  const keyToShop = new Map((map ?? []).map((m) => [m.shop_key as string, m.shop_id as string]));
  const projectShopIds = new Set(
    (projShops ?? []).map((p) => keyToShop.get(p.shop_key as string)).filter((s): s is string => !!s)
  );
  const plan = planBulkDeals({
    parsed,
    existing,
    members: (members ?? []) as TeamMemberLite[],
    bizdevRoles: BIZDEV_ROLES,
    projectShopIds,
    options: await loadDealOptions(client),
  });
  return { plan, envRowCount: existing.length };
}

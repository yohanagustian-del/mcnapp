import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { isMissingRelationError, MIGRATION_0087_MISSING, MIGRATION_0097_MISSING } from "@/lib/db/missing-migration";
import { loadHandlerIndex } from "@/lib/deals/bizdev-handlers";
import { todayWib } from "@/lib/utils/date";
import {
  brandFilterOptions,
  buildBrandRows,
  DEFAULT_PAGE_SIZE,
  filterBrandRows,
  paginate,
  sortBrandRows,
  type BrandDealSource,
  type BrandFilters,
} from "@/lib/deals/brand-table";
import { BrandFiltersBar } from "./brand-filters";
import { BrandTableView } from "./brand-table-view";

const BASE_COLS =
  "id, platform, brand_name, shop_id, shop_key, status, niche, brand_link, contact_pic_brand, nama_grup, gmv_tap, avg_price, ads_brand, leads_type, priority, campaign_name, campaign_id, exp_date, shop_code";
const COLS_0097 = "bizdev_label, support_types, working_sheet, campaign_ops_id";

/** brand_deals aktif. 0097 belum ada → kolom dasar saja (tanpa support/working sheet/Campaign Ops). */
async function loadActiveDeals(supabase: SupabaseClient): Promise<{ deals: BrandDealSource[]; has0097: boolean }> {
  try {
    const deals = await fetchAll<BrandDealSource>(supabase, "brand_deals", `${BASE_COLS}, ${COLS_0097}`, (q) =>
      q.is("deactivated_at", null).order("id")
    );
    return { deals, has0097: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (!isMissingRelationError({ message })) throw e;
    const deals = await fetchAll<BrandDealSource>(supabase, "brand_deals", BASE_COLS, (q) => q.order("id"));
    return { deals, has0097: false };
  }
}

export interface BrandViewParams extends BrandFilters {
  page?: string;
  size?: string;
}

/** Tab "Brand" Deal Brand (D-2026-10-22-1): satu baris per brand_deals aktif, kolom = sheet Database Bizdev. */
export async function BrandView({ supabase, params }: { supabase: SupabaseClient; params: BrandViewParams }) {
  const { deals, has0097 } = await loadActiveDeals(supabase);
  const shopKeys = [...new Set(deals.map((d) => d.shop_key).filter((k): k is string => !!k))];
  const [handlerIndex, { data: memberRows }] = await Promise.all([
    // Tanpa filter shop_key: tabelnya kecil (≤ 2 baris per brand) dan .in() ratusan nama shop
    // akan melewati batas panjang URL PostgREST.
    loadHandlerIndex(supabase),
    supabase.from("team_members").select("id, name"),
  ]);
  const memberNameById = new Map((memberRows ?? []).map((m) => [m.id as string, m.name as string]));
  const rows = buildBrandRows(deals, {
    handlersByShopKey: handlerIndex.byShopKey,
    memberNameById,
    today: todayWib(),
  });

  const filters: BrandFilters = {
    q: params.q?.trim() || undefined,
    platform: params.platform || undefined,
    bizdev: params.bizdev || undefined,
    status: params.status || undefined,
    niche: params.niche || undefined,
    priority: params.priority || undefined,
    ops: params.ops || undefined,
  };
  const filtered = sortBrandRows(filterBrandRows(rows, filters));
  const pageData = paginate(filtered, Number(params.page ?? 1), Number(params.size ?? DEFAULT_PAGE_SIZE));

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) sp.set(k, v);
    if (pageData.pageSize !== DEFAULT_PAGE_SIZE) sp.set("size", String(pageData.pageSize));
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/deals?${s}` : "/deals";
  };

  return (
    <div>
      {!has0097 && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Kolom Sample/Flash Sale/Ads, Working Sheet, Campaign Ops, dan label Bizdev sheet belum tersedia: {MIGRATION_0097_MISSING}
        </p>
      )}
      {handlerIndex.missing && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          BizDev penanggung jawab belum aktif: {MIGRATION_0087_MISSING}
        </p>
      )}

      <BrandFiltersBar filters={filters} pageSize={pageData.pageSize} options={brandFilterOptions(rows)} />

      <div className="mt-3">
        <BrandTableView rows={pageData.rows} offset={pageData.from ? pageData.from - 1 : 0} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>
          Menampilkan {pageData.from}–{pageData.to} dari {pageData.total} brand
          {pageData.total !== rows.length && <span className="text-slate-400"> (total {rows.length} brand aktif)</span>}
        </span>
        <nav className="flex items-center gap-1" aria-label="Halaman">
          <PageLink href={pageHref(pageData.page - 1)} disabled={pageData.page <= 1}>‹ Sebelumnya</PageLink>
          <span className="px-2">
            Halaman {pageData.page} / {pageData.pageCount}
          </span>
          <PageLink href={pageHref(pageData.page + 1)} disabled={pageData.page >= pageData.pageCount}>Berikutnya ›</PageLink>
        </nav>
      </div>
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span className="rounded-md px-3 py-1.5 text-slate-300">{children}</span>;
  return (
    <Link href={href} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
      {children}
    </Link>
  );
}

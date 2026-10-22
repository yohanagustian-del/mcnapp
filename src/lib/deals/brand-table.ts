import { countdownDays, NON_BD_LABELS } from "@/lib/deals/bulk-deal-spec";
import { normalizeDealStatus } from "@/lib/deals/deal-status";

/**
 * Tabel Deal Brand per BRAND (satu baris = satu baris `brand_deals` aktif), sesuai mock
 * Yohan 2026-10-22 (D-2026-10-22-1). Murni — filter, cari, urut, dan paginasi dipakai
 * halaman /deals dan test yang sama.
 *
 * brand_deals = master brand (ratusan baris, bukan data transaksi), jadi seluruh baris
 * aktif dimuat sekali lalu disaring di sini; daftar pilihan filter (niche, BizDev, …)
 * diturunkan dari baris yang sama sehingga hitungan "dari N brand" selalu cocok.
 */

export const NON_BD_FILTER = "__non_bd__";
export const NON_OPS_FILTER = "__non_ops__";
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

export interface BrandDealSource {
  id: string;
  platform: string | null;
  brand_name: string | null;
  shop_id: string | null;
  shop_key: string | null;
  bizdev_label?: string | null;
  status: string | null;
  niche: string | null;
  brand_link: string | null;
  contact_pic_brand: string | null;
  nama_grup: string | null;
  gmv_tap: number | string | null;
  avg_price: number | string | null;
  support_types?: string[] | null;
  ads_brand: string | null;
  leads_type: string | null;
  priority: string | null;
  working_sheet?: string | null;
  campaign_ops_id?: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  exp_date: string | null;
  shop_code: string | null;
}

export interface BrandRow {
  id: string;
  platform: string | null;
  brandName: string;
  shopId: string | null;
  /** Nama BizDev penanggung jawab: akun (brand_bizdev_handlers) dulu, kalau kosong label sheet. */
  bizdev: string[];
  status: string | null;
  niche: string | null;
  brandLink: string | null;
  contactPic: string | null;
  grup: string | null;
  gmvTap: number | null;
  avgPrice: number | null;
  supportTypes: string[];
  adsBrand: string | null;
  leadsType: string | null;
  priority: string | null;
  workingSheet: string | null;
  campaignOpsId: string | null;
  campaignOps: string | null;
  campaignName: string | null;
  campaignId: string | null;
  expDate: string | null;
  countdown: number | null;
  shopCode: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Label kolom Bizdev sheet → nama; "Non BD Hande/Handle" = tanpa BizDev. */
export function bizdevFromLabel(label: string | null | undefined): string[] {
  const raw = (label ?? "").trim();
  if (!raw || NON_BD_LABELS.includes(raw.toLowerCase())) return [];
  return [...new Set(raw.split(/[,;/&]+/).map((s) => s.trim()).filter(Boolean))];
}

export function buildBrandRows(
  deals: BrandDealSource[],
  ctx: { handlersByShopKey: Map<string, { name: string }[]>; memberNameById: Map<string, string>; today: string }
): BrandRow[] {
  return deals.map((d) => {
    const handlers = d.shop_key ? ctx.handlersByShopKey.get(d.shop_key) ?? [] : [];
    return {
      id: d.id,
      platform: d.platform,
      brandName: d.brand_name?.trim() || d.shop_key || d.id,
      shopId: d.shop_id,
      bizdev: handlers.length ? handlers.map((h) => h.name) : bizdevFromLabel(d.bizdev_label),
      status: normalizeDealStatus(d.status) ?? d.status,
      niche: d.niche?.trim() || null,
      brandLink: d.brand_link?.trim() || null,
      contactPic: d.contact_pic_brand?.trim() || null,
      grup: d.nama_grup?.trim() || null,
      gmvTap: num(d.gmv_tap),
      avgPrice: num(d.avg_price),
      supportTypes: d.support_types ?? [],
      adsBrand: d.ads_brand?.trim() || null,
      leadsType: d.leads_type?.trim() || null,
      priority: d.priority?.trim() || null,
      workingSheet: d.working_sheet?.trim() || null,
      campaignOpsId: d.campaign_ops_id ?? null,
      campaignOps: d.campaign_ops_id ? ctx.memberNameById.get(d.campaign_ops_id) ?? null : null,
      campaignName: d.campaign_name?.trim() || null,
      campaignId: d.campaign_id?.trim() || null,
      expDate: d.exp_date,
      countdown: countdownDays(d.exp_date, ctx.today),
      shopCode: d.shop_code?.trim() || null,
    };
  });
}

export interface BrandFilters {
  q?: string;
  platform?: string;
  bizdev?: string;
  status?: string;
  niche?: string;
  priority?: string;
  ops?: string;
}

export function filterBrandRows(rows: BrandRow[], f: BrandFilters): BrandRow[] {
  const terms = (f.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (terms.length) {
      const hay = `${r.brandName} ${r.shopId ?? ""} ${r.shopCode ?? ""}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (f.platform && r.platform !== f.platform) return false;
    if (f.bizdev) {
      if (f.bizdev === NON_BD_FILTER ? r.bizdev.length > 0 : !r.bizdev.includes(f.bizdev)) return false;
    }
    if (f.status && r.status !== f.status) return false;
    if (f.niche && r.niche !== f.niche) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (f.ops) {
      if (f.ops === NON_OPS_FILTER ? r.campaignOpsId !== null : r.campaignOpsId !== f.ops) return false;
    }
    return true;
  });
}

/** Urutan bawaan: brand yang paling dekat kadaluarsa (countdown ≥ 0) dulu, lalu GMV TAP terbesar, lalu nama. */
export function sortBrandRows(rows: BrandRow[]): BrandRow[] {
  return [...rows].sort((a, b) => {
    const ca = a.countdown !== null && a.countdown >= 0 ? a.countdown : Infinity;
    const cb = b.countdown !== null && b.countdown >= 0 ? b.countdown : Infinity;
    if (ca !== cb) return ca - cb;
    const ga = a.gmvTap ?? -1;
    const gb = b.gmvTap ?? -1;
    if (ga !== gb) return gb - ga;
    return a.brandName.localeCompare(b.brandName, "id");
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const size = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  return { rows: rows.slice(start, start + size), page: current, pageCount, pageSize: size, from: rows.length ? start + 1 : 0, to: Math.min(start + size, rows.length), total: rows.length };
}

const distinct = (vals: (string | null)[]) =>
  [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "id"));

/** Pilihan dropdown filter, diturunkan dari seluruh baris aktif. */
export function brandFilterOptions(rows: BrandRow[]) {
  const ops = new Map<string, string>();
  for (const r of rows) if (r.campaignOpsId) ops.set(r.campaignOpsId, r.campaignOps ?? r.campaignOpsId);
  return {
    platforms: distinct(rows.map((r) => r.platform)),
    bizdev: distinct(rows.flatMap((r) => r.bizdev)),
    niches: distinct(rows.map((r) => r.niche)),
    priorities: distinct(rows.map((r) => r.priority)),
    campaignOps: [...ops].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "id")),
  };
}

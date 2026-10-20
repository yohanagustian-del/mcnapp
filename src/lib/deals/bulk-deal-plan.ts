import {
  bulkDealKey,
  outOfListValues,
  MAX_BULK_BIZDEV,
  type BulkDealParseResult,
  type BulkDealRow,
} from "./bulk-deal-spec";
import { normalizeDealStatus } from "./deal-status";
import { NICHE_MERGE_PROPOSALS, type DealOptions } from "./deal-options";

/**
 * Rencana Import Bulk Deal Brand: sheet (hasil parseBulkDealMatrix) vs isi brand_deals
 * suatu environment. Pure — SATU logika dipakai tombol Import di /deals/import, halaman
 * preview, dan scripts/mcn-bulkload-dryrun.ts (CLAUDE.md #4).
 *
 * Kunci = (platform, shop_id, brand_name) persis (DECISIONS D-2026-10-20-4).
 * Import di UI hanya INSERT/UPDATE (upsert). Baris environment yang tidak ada di sheet
 * hanya dilaporkan (kandidat soft-deactivate) — Replace = langkah "Promote ke Produksi"
 * terpisah yang butuh persetujuan Yohan (D-2026-10-20-5).
 */

export const BULK_PLATFORM = "tiktok";

/** Kolom brand_deals yang ditulis dari sheet (dan dibandingkan untuk diff per field). */
export const BULK_DEAL_FIELDS = [
  "brand_name", "shop_id", "bizdev_label", "status", "niche", "brand_link", "contact_pic_brand",
  "nama_grup", "gmv_tap", "avg_price", "support_types", "ads_brand", "leads_type", "priority",
  "working_sheet", "campaign_ops_id", "campaign_name", "campaign_id", "exp_date", "shop_code",
] as const;
export type BulkDealField = (typeof BULK_DEAL_FIELDS)[number];

/** Kolom berisi kontak pribadi — diff-nya tidak menampilkan nilai di laporan. */
export const SENSITIVE_FIELDS: BulkDealField[] = ["contact_pic_brand", "nama_grup"];

export type DealRecord = Record<BulkDealField, string | number | string[] | null> & { status: string | null };

export interface ExistingDeal extends Partial<Record<BulkDealField, unknown>> {
  id: string;
  platform: string | null;
  brand_name: string;
  shop_id: string | null;
  deactivated_at?: string | null;
}

export interface TeamMemberLite {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export interface FieldDiff {
  field: BulkDealField;
  before: unknown;
  after: unknown;
}

export interface PlannedRow {
  row: BulkDealRow;
  record: DealRecord;
  /** Ada → update baris ini; null → insert. */
  existingId: string | null;
  diffs: FieldDiff[];
}

export interface NameMatch {
  name: string;
  memberId: string | null;
  /** Nama anggota yang mirip (awalan/kata sama) — TIDAK dipakai otomatis, hanya dilaporkan. */
  candidates: string[];
  inactive: boolean;
}

export interface HandlerPlan {
  shopId: string;
  brands: string[];
  memberIds: string[];
  /** Nama sheet yang tidak cocok persis dengan anggota BizDev aktif. */
  unmatched: string[];
  /** >2 nama berbeda di brand-brand yang berbagi shop ini → handler shop tidak diubah. */
  conflict: boolean;
  /**
   * Ditulis ke brand_bizdev_handlers hanya bila SEMUA nama cocok & tanpa konflik — nama
   * yang tidak cocok tidak boleh membuat handler lama terhapus diam-diam.
   */
  apply: boolean;
}

export interface BulkDealPlan {
  inserts: PlannedRow[];
  updates: PlannedRow[];
  unchanged: PlannedRow[];
  /** Baris environment (platform tiktok, aktif) yang tidak ada di sheet. */
  missingFromSheet: ExistingDeal[];
  skipped: BulkDealParseResult["skipped"];
  handlers: HandlerPlan[];
  bizdevNames: NameMatch[];
  campaignOpsNames: NameMatch[];
  statusNull: { sheetRow: number; brandName: string; shopId: string; raw: string }[];
  adsOutOfList: ReturnType<typeof outOfListValues>;
  /** Brand ber-Ads Brand (dalam daftar) yang shop-nya belum ada di Project BD mana pun. */
  adsNeedsProject: { sheetRow: number; brandName: string; shopId: string; value: string }[];
  leadsOutOfList: ReturnType<typeof outOfListValues>;
  nicheOutOfList: ReturnType<typeof outOfListValues>;
  nicheEmpty: { sheetRow: number; brandName: string; shopId: string }[];
  nicheMergeProposals: { from: string; to: string; note: string; count: number }[];
  warnings: { sheetRow: number; brandName: string; message: string }[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Pencocokan nama PERSIS (tanpa beda huruf besar/kecil & spasi). Tidak menebak. */
export function matchMemberName(name: string, members: TeamMemberLite[], roles?: readonly string[]): NameMatch {
  const pool = roles ? members.filter((m) => roles.includes(m.role)) : members;
  const exact = pool.filter((m) => norm(m.name) === norm(name));
  const active = exact.find((m) => m.active);
  const words = norm(name).split(" ");
  const candidates = pool
    .filter((m) => !exact.includes(m) && norm(m.name).split(" ").some((w) => words.includes(w)))
    .map((m) => `${m.name}${m.active ? "" : " (nonaktif)"} [${m.role}]`);
  return {
    name,
    memberId: active?.id ?? null,
    candidates,
    inactive: !active && exact.length > 0,
  };
}

export function toDealRecord(row: BulkDealRow, campaignOpsId: string | null): DealRecord {
  return {
    brand_name: row.brandName,
    shop_id: row.shopId,
    bizdev_label: row.bizdevLabel,
    status: row.status,
    niche: row.niche,
    brand_link: row.brandLink,
    contact_pic_brand: row.contactPic,
    nama_grup: row.namaGrup,
    gmv_tap: row.gmvTap,
    avg_price: row.avgPrice,
    support_types: row.supportTypes,
    ads_brand: row.adsBrand,
    leads_type: row.leadsType,
    priority: row.priority,
    working_sheet: row.workingSheet,
    campaign_ops_id: campaignOpsId,
    campaign_name: row.campaignName,
    campaign_id: row.campaignId,
    exp_date: row.expDate,
    shop_code: row.shopCode,
  };
}

function sameValue(field: BulkDealField, a: unknown, b: unknown): boolean {
  if (field === "status") return normalizeDealStatus(a as string | null) === normalizeDealStatus(b as string | null);
  const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  if (blank(a) && blank(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a ?? "") === String(b ?? "");
}

export function diffRecord(existing: ExistingDeal | null, record: DealRecord): FieldDiff[] {
  if (!existing) return [];
  return BULK_DEAL_FIELDS.filter((f) => !sameValue(f, existing[f], record[f])).map((f) => ({
    field: f,
    before: existing[f] ?? null,
    after: record[f],
  }));
}

export interface PlanInput {
  parsed: BulkDealParseResult;
  existing: ExistingDeal[];
  members: TeamMemberLite[];
  bizdevRoles: readonly string[];
  /** shop_id (TikTok) yang sudah terpasang di salah satu Project BD. */
  projectShopIds: Set<string>;
  options: DealOptions;
}

export function planBulkDeals(input: PlanInput): BulkDealPlan {
  const { parsed, members, options } = input;
  const existing = input.existing.filter((e) => (e.platform ?? BULK_PLATFORM) === BULK_PLATFORM && !e.deactivated_at);
  const byKey = new Map<string, ExistingDeal>();
  for (const e of existing) if (e.shop_id) byKey.set(bulkDealKey(e.shop_id, e.brand_name), e);

  const opsCache = new Map<string, NameMatch>();
  const opsMatch = (name: string) => {
    if (!opsCache.has(name)) opsCache.set(name, matchMemberName(name, members));
    return opsCache.get(name)!;
  };

  const inserts: PlannedRow[] = [];
  const updates: PlannedRow[] = [];
  const unchanged: PlannedRow[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const key = bulkDealKey(row.shopId, row.brandName);
    seen.add(key);
    const ops = row.campaignOpsName ? opsMatch(row.campaignOpsName) : null;
    const record = toDealRecord(row, ops?.memberId ?? null);
    const ex = byKey.get(key) ?? null;
    const diffs = diffRecord(ex, record);
    const planned = { row, record, existingId: ex?.id ?? null, diffs };
    if (!ex) inserts.push(planned);
    else if (diffs.length) updates.push(planned);
    else unchanged.push(planned);
  }
  const missingFromSheet = existing.filter((e) => !e.shop_id || !seen.has(bulkDealKey(e.shop_id, e.brand_name)));

  // BizDev handler per shop (brand_bizdev_handlers dikunci per shop_key = per shop).
  const nameCache = new Map<string, NameMatch>();
  const bizdevMatch = (name: string) => {
    if (!nameCache.has(name)) nameCache.set(name, matchMemberName(name, members, input.bizdevRoles));
    return nameCache.get(name)!;
  };
  const byShop = new Map<string, BulkDealRow[]>();
  for (const row of parsed.rows) byShop.set(row.shopId, [...(byShop.get(row.shopId) ?? []), row]);
  const handlers: HandlerPlan[] = [];
  for (const [shopId, rows] of byShop) {
    const names = [...new Set(rows.flatMap((r) => r.bizdevNames))];
    if (names.length === 0) continue; // "Non BD Hande": handler yang ada tidak disentuh
    const matches = names.map(bizdevMatch);
    const ids = [...new Set(matches.map((m) => m.memberId).filter((id): id is string => !!id))];
    const unmatched = matches.filter((m) => !m.memberId).map((m) => m.name);
    const conflict = names.length > MAX_BULK_BIZDEV;
    handlers.push({
      shopId,
      brands: rows.map((r) => r.brandName),
      memberIds: ids,
      unmatched,
      conflict,
      apply: !conflict && unmatched.length === 0 && ids.length > 0,
    });
  }

  const allBizdevNames = [...new Set(parsed.rows.flatMap((r) => r.bizdevNames))].sort();
  const allOpsNames = [...new Set(parsed.rows.map((r) => r.campaignOpsName).filter((n): n is string => !!n))].sort();

  const adsKnown = new Set(options.adsSupport);
  const nicheCounts = new Map<string, number>();
  for (const r of parsed.rows) if (r.niche) nicheCounts.set(r.niche, (nicheCounts.get(r.niche) ?? 0) + 1);

  return {
    inserts,
    updates,
    unchanged,
    missingFromSheet,
    skipped: parsed.skipped,
    handlers,
    bizdevNames: allBizdevNames.map(bizdevMatch),
    campaignOpsNames: allOpsNames.map(opsMatch),
    statusNull: parsed.rows
      .filter((r) => r.status === null)
      .map((r) => ({ sheetRow: r.sheetRow, brandName: r.brandName, shopId: r.shopId, raw: r.statusRaw })),
    adsOutOfList: outOfListValues(parsed.rows, "adsBrand", options.adsSupport),
    adsNeedsProject: parsed.rows
      .filter((r) => r.adsBrand && adsKnown.has(r.adsBrand) && !input.projectShopIds.has(r.shopId))
      .map((r) => ({ sheetRow: r.sheetRow, brandName: r.brandName, shopId: r.shopId, value: r.adsBrand! })),
    leadsOutOfList: outOfListValues(parsed.rows, "leadsType", options.leadsType),
    nicheOutOfList: outOfListValues(parsed.rows, "niche", options.niche),
    nicheEmpty: parsed.rows
      .filter((r) => !r.niche)
      .map((r) => ({ sheetRow: r.sheetRow, brandName: r.brandName, shopId: r.shopId })),
    nicheMergeProposals: NICHE_MERGE_PROPOSALS.map((p) => ({ ...p, count: nicheCounts.get(p.from) ?? 0 })).filter(
      (p) => p.count > 0
    ),
    warnings: parsed.rows.flatMap((r) =>
      r.warnings.map((message) => ({ sheetRow: r.sheetRow, brandName: r.brandName, message }))
    ),
  };
}

/** FK yang menunjuk brand_deals.id — dipakai laporan Replace (hard-delete dilarang bila ada). */
export const BRAND_DEAL_FK_REFS: { table: string; column: string }[] = [
  { table: "cooperating_shops", column: "deal_id" },
  { table: "campaign_requests", column: "deal_id" },
  { table: "deal_live_sessions", column: "deal_id" },
  { table: "deal_creator_proposals", column: "deal_id" },
  { table: "brand_reports", column: "deal_id" },
  { table: "live_schedule_slots", column: "deal_id" },
  { table: "deal_products", column: "deal_id" },
  { table: "ads_briefs", column: "deal_id" },
  { table: "brand_leads", column: "converted_deal_id" },
];

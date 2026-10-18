import type { SupabaseClient } from "@supabase/supabase-js";
import { NON_BD_HANDLE_LABEL } from "@/lib/deals/bizdev-handler-spec";
import { isMissingRelationError } from "@/lib/db/missing-migration";
import { brandLeadSearchPatterns } from "@/lib/leads/brand-lead";
import { periodKey } from "./shop-perf-data";
import type { PeriodSelection } from "./period";

/**
 * Summary per BizDev (REVISI_BIZDEV T6). Agregasi di SQL (migrasi 0096):
 *   bizdev_member_summary  → kartu per BizDev
 *   bizdev_brand_breakdown → tabel breakdown (BizDev × brand)
 * Keduanya membaca bizdev_brand_perf apa adanya — tidak menghitung ulang GMV (CLAUDE.md #4).
 * Dulu halaman memuat SEMUA baris shop (Oktober 2026: 51 ribu, 52 query berurutan) lalu
 * mengagregasi di JS → /workspace/bizdev menggantung untuk Management & BizDev Lead.
 *
 * Aturan (dijaga view):
 * - Brand dengan 2 BizDev dihitung PENUH di keduanya (bukan dibagi dua) — ditulis di UI.
 * - member_id null = "Non BD Handle", selalu kartu terakhir; termasuk shop tanpa
 *   kartu/deal (shop_key null), dikenali per (platform, shop_id) (K4 = B).
 * - Satu shop_id dengan beberapa shop_key (K5 = C) tampil di tiap shop_key — dobel disengaja.
 * - GMV TAP null (Shopee fase 1, Q4) tidak dianggap 0: GMV TAP & %TAP/MCN hanya dari
 *   baris yang data TAP-nya ada; GMV MCN baris tanpa data TAP dilaporkan terpisah.
 */

type Num = number | string | null;

/** Baris view bizdev_member_summary. */
export interface BizdevMemberRow {
  member_id: string | null;
  member_name: string | null;
  brand_count: Num;
  gmv_mcn: Num;
  gmv_mcn_tap_known: Num;
  gmv_mcn_tap_unknown: Num;
  gmv_tap: Num;
  actual_partner_commission: Num;
}

/** Baris view bizdev_brand_breakdown. */
export interface BizdevBreakdownViewRow extends Omit<BizdevMemberRow, "brand_count"> {
  brand_key: string;
  shop_key: string | null;
  platform: string;
  shop_name: string;
  creator_count: Num;
  creator_tap_count: Num;
}

interface Totals {
  gmvMcn: number;
  /** GMV MCN dari baris yang data TAP-nya tersedia (penyebut %TAP/MCN). */
  gmvMcnTapKnown: number;
  /** GMV MCN dari baris tanpa data TAP (Shopee / upload tanpa file TAP). */
  gmvMcnTapUnknown: number;
  gmvTap: number | null;
  actualRevenuePartner: number | null;
  tapShare: number | null;
}

export interface BizdevCard extends Totals {
  memberId: string | null;
  memberName: string;
  brandCount: number;
}

export interface BizdevBreakdownRow extends Totals {
  key: string;
  memberId: string | null;
  memberName: string;
  shopKey: string | null;
  shopName: string;
  platform: string;
  creatorCount: number;
  creatorTapCount: number;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function totals(r: Omit<BizdevMemberRow, "brand_count" | "member_id" | "member_name">): Totals {
  const gmvTap = num(r.gmv_tap);
  const gmvMcnTapKnown = num(r.gmv_mcn_tap_known) ?? 0;
  return {
    gmvMcn: num(r.gmv_mcn) ?? 0,
    gmvMcnTapKnown,
    gmvMcnTapUnknown: num(r.gmv_mcn_tap_unknown) ?? 0,
    gmvTap,
    actualRevenuePartner: num(r.actual_partner_commission),
    tapShare: gmvTap !== null && gmvMcnTapKnown > 0 ? gmvTap / gmvMcnTapKnown : null,
  };
}

const memberLabel = (id: string | null, name: string | null) => (id ? (name ?? "—") : NON_BD_HANDLE_LABEL);

/** Kartu per BizDev; Non BD Handle selalu terakhir, sisanya urut GMV MCN. */
export function toBizdevCards(rows: BizdevMemberRow[]): BizdevCard[] {
  return rows
    .map((r) => ({
      ...totals(r),
      memberId: r.member_id,
      memberName: memberLabel(r.member_id, r.member_name),
      brandCount: num(r.brand_count) ?? 0,
    }))
    .sort((a, b) => {
      if ((a.memberId === null) !== (b.memberId === null)) return a.memberId === null ? 1 : -1;
      return b.gmvMcn - a.gmvMcn || a.memberName.localeCompare(b.memberName, "id");
    });
}

export function toBizdevBreakdown(rows: BizdevBreakdownViewRow[]): BizdevBreakdownRow[] {
  return rows.map((r) => ({
    ...totals(r),
    key: `${r.member_id ?? "__non_bd__"}|${r.brand_key}`,
    memberId: r.member_id,
    memberName: memberLabel(r.member_id, r.member_name),
    shopKey: r.shop_key,
    shopName: r.shop_name,
    platform: r.platform,
    creatorCount: num(r.creator_count) ?? 0,
    creatorTapCount: num(r.creator_tap_count) ?? 0,
  }));
}

/**
 * Batas baris breakdown yang dikirim ke browser (urut GMV MCN tertinggi). Bulan penuh
 * berisi puluhan ribu shop "Non BD Handle"; sisanya dicari lewat pencarian server.
 */
export const BREAKDOWN_LIMIT = 1000;

const MEMBER_COLS =
  "member_id, member_name, brand_count, gmv_mcn, gmv_mcn_tap_known, gmv_mcn_tap_unknown, gmv_tap, actual_partner_commission";
const BREAKDOWN_COLS =
  "member_id, member_name, brand_key, shop_key, platform, shop_name, creator_count, creator_tap_count, gmv_mcn, gmv_mcn_tap_known, gmv_mcn_tap_unknown, gmv_tap, actual_partner_commission";

export interface BizdevSummaryData {
  cards: BizdevCard[];
  breakdown: BizdevBreakdownRow[];
  /** Jumlah baris breakdown periode ini (tanpa filter pencarian) = Σ brand_count kartu. */
  breakdownTotal: number;
  /** `true` = migrasi 0096 belum di-apply. */
  missing: boolean;
}

/**
 * Kartu + breakdown satu periode. `memberId` = batasi ke brand yang di-handle akun itu
 * (K11 = B, tanpa m8.bizdev_summary_all) — difilter di query, bukan cuma di UI.
 * `search` = filter nama brand/BizDev (ILIKE per kata) untuk breakdown saja.
 */
export async function loadBizdevSummary(
  client: SupabaseClient,
  sel: PeriodSelection,
  opts: { memberId?: string; search?: string } = {}
): Promise<BizdevSummaryData> {
  const { kind, key } = periodKey(sel);

  let cardsQ = client.from("bizdev_member_summary").select(MEMBER_COLS).eq("period_kind", kind).eq("period_key", key);
  let breakdownQ = client
    .from("bizdev_brand_breakdown")
    .select(BREAKDOWN_COLS)
    .eq("period_kind", kind)
    .eq("period_key", key);
  if (opts.memberId) {
    cardsQ = cardsQ.eq("member_id", opts.memberId);
    breakdownQ = breakdownQ.eq("member_id", opts.memberId);
  }
  for (const p of brandLeadSearchPatterns(opts.search)) breakdownQ = breakdownQ.ilike("search_text", p);

  const [cardsRes, breakdownRes] = await Promise.all([
    cardsQ,
    breakdownQ.order("gmv_mcn", { ascending: false }).order("brand_key", { ascending: true }).limit(BREAKDOWN_LIMIT),
  ]);
  for (const res of [cardsRes, breakdownRes]) {
    if (res.error) {
      if (isMissingRelationError(res.error)) return { cards: [], breakdown: [], breakdownTotal: 0, missing: true };
      throw new Error(`Gagal memuat summary BizDev: ${res.error.message}`);
    }
  }
  const cards = toBizdevCards((cardsRes.data ?? []) as BizdevMemberRow[]);
  return {
    cards,
    breakdown: toBizdevBreakdown((breakdownRes.data ?? []) as BizdevBreakdownViewRow[]),
    breakdownTotal: cards.reduce((s, c) => s + c.brandCount, 0),
    missing: false,
  };
}

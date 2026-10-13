import { NON_BD_HANDLE_LABEL } from "@/lib/deals/bizdev-handler-spec";

/**
 * Summary per BizDev (REVISI_BIZDEV T6) — murni: baris view `bizdev_brand_perf` (sudah
 * diagregasi SQL per shop × periode × handler) → kartu per BizDev + tabel breakdown.
 * Tidak menghitung ulang GMV dari sumber lain (CLAUDE.md #4).
 *
 * Aturan:
 * - Brand dengan 2 BizDev dihitung PENUH di keduanya (bukan dibagi dua) — ditulis di UI.
 * - member_id null = "Non BD Handle", selalu kartu terakhir.
 * - GMV TAP null (Shopee fase 1, Q4) tidak dianggap 0: GMV TAP & %TAP/MCN hanya dari
 *   baris yang data TAP-nya ada; GMV MCN baris tanpa data TAP dilaporkan terpisah.
 */

export interface BizdevPerfRow {
  platform: string;
  shop_id: string;
  shop_name: string | null;
  shop_key: string;
  creator_count: number | string | null;
  creator_tap_count: number | string | null;
  gmv_mcn: number | string | null;
  gmv_tap: number | string | null;
  actual_partner_commission: number | string | null;
  member_id: string | null;
  member_name: string | null;
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
  shopKey: string;
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

function emptyTotals(): Totals {
  return { gmvMcn: 0, gmvMcnTapKnown: 0, gmvMcnTapUnknown: 0, gmvTap: null, actualRevenuePartner: null, tapShare: null };
}

function addRow(t: Totals, r: BizdevPerfRow): void {
  const mcn = num(r.gmv_mcn) ?? 0;
  const tap = num(r.gmv_tap);
  const rev = num(r.actual_partner_commission);
  t.gmvMcn += mcn;
  if (tap === null) t.gmvMcnTapUnknown += mcn;
  else {
    t.gmvMcnTapKnown += mcn;
    t.gmvTap = (t.gmvTap ?? 0) + tap;
  }
  if (rev !== null) t.actualRevenuePartner = (t.actualRevenuePartner ?? 0) + rev;
}

function finish<T extends Totals>(t: T): T {
  t.tapShare = t.gmvTap !== null && t.gmvMcnTapKnown > 0 ? t.gmvTap / t.gmvMcnTapKnown : null;
  return t;
}

export function buildBizdevSummary(rows: BizdevPerfRow[]): { cards: BizdevCard[]; breakdown: BizdevBreakdownRow[] } {
  const breakdown = new Map<string, BizdevBreakdownRow>();
  const cards = new Map<string, BizdevCard & { shops: Set<string> }>();

  for (const r of rows) {
    const memberKey = r.member_id ?? "__non_bd__";
    const memberName = r.member_id ? (r.member_name ?? "—") : NON_BD_HANDLE_LABEL;

    const card =
      cards.get(memberKey) ??
      { ...emptyTotals(), memberId: r.member_id, memberName, brandCount: 0, shops: new Set<string>() };
    addRow(card, r);
    card.shops.add(r.shop_key);
    cards.set(memberKey, card);

    const bKey = `${memberKey}|${r.shop_key}`;
    const b =
      breakdown.get(bKey) ??
      {
        ...emptyTotals(), key: bKey, memberId: r.member_id, memberName, shopKey: r.shop_key,
        shopName: r.shop_name ?? r.shop_key, platform: r.platform, creatorCount: 0, creatorTapCount: 0,
      };
    addRow(b, r);
    b.creatorCount += num(r.creator_count) ?? 0;
    b.creatorTapCount += num(r.creator_tap_count) ?? 0;
    if (b.shopName === b.shopKey && r.shop_name) b.shopName = r.shop_name;
    breakdown.set(bKey, b);
  }

  const cardList = [...cards.values()].map(({ shops, ...c }) => finish({ ...c, brandCount: shops.size }));
  cardList.sort((a, b) => {
    if ((a.memberId === null) !== (b.memberId === null)) return a.memberId === null ? 1 : -1;
    return b.gmvMcn - a.gmvMcn || a.memberName.localeCompare(b.memberName, "id");
  });
  const breakdownList = [...breakdown.values()].map(finish).sort((a, b) => b.gmvMcn - a.gmvMcn);
  return { cards: cardList, breakdown: breakdownList };
}

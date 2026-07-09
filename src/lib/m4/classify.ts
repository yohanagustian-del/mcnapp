/**
 * M4 Link Leakage — pure classification rules (PRD Module 04 §2.2–2.4).
 * Deterministic only: joins/diffs/thresholds. NO LLM anywhere in this module.
 *
 * Platform data is AGGREGATE per (product_id, shop_id, period) — no txn_ref.
 * Leak per pair = affiliate_gmv[CSV-1 all] − affiliate_gmv[CSV-2 agency-link],
 * joined on (product_id, shop_id).
 */

export type LinkStatus = "via_agency" | "bocor_sebagian" | "bocor_total" | "belum_ada_link";

/** Rupiah amounts: differences under 1 rupiah are rounding noise, not leakage. */
const EPSILON = 1;

/**
 * CSV-2 has no creator column, so a pair's agency GMV is allocated to each
 * creator proportionally to their share of the pair's total GMV in CSV-1.
 * Single-creator files (the common case) have share = 1 → exact.
 */
export function allocateAgencyGmv(
  creatorPairGmv: number,
  pairGmvAllCreators: number,
  pairGmvAgency: number
): number {
  if (creatorPairGmv <= 0 || pairGmvAllCreators <= 0) return 0;
  const share = creatorPairGmv / pairGmvAllCreators;
  return Math.min(pairGmvAgency * share, creatorPairGmv);
}

/** Pair-level status on an ACTIVE-deal shop (non-deal shops are leads, not links). */
export function classifyPairStatus(gmvAll: number, gmvAgency: number): LinkStatus {
  const bocor = Math.max(gmvAll - gmvAgency, 0);
  if (bocor <= EPSILON) return "via_agency";
  if (gmvAgency <= EPSILON) return "bocor_total";
  return "bocor_sebagian";
}

export interface CreatorRollup {
  leakRatio: number | null;
  status: LinkStatus;
}

/**
 * Creator rollup (PRD §2.3, ratio basis = GMV, LOCKED):
 *   ratio = leaked GMV / total GMV on active-deal shops.
 * Thresholds come from app_config (m4.bocor_sebagian / m4.bocor_total) — never hardcoded.
 */
export function rollupCreatorStatus(
  gmvDealTotal: number,
  gmvBocor: number,
  thresholds: { sebagian: number; total: number }
): CreatorRollup {
  if (gmvDealTotal <= 0) return { leakRatio: null, status: "belum_ada_link" };
  const ratio = Math.min(Math.max(gmvBocor / gmvDealTotal, 0), 1);
  if (ratio <= thresholds.sebagian) return { leakRatio: ratio, status: "via_agency" };
  if (ratio <= thresholds.total) return { leakRatio: ratio, status: "bocor_sebagian" };
  return { leakRatio: ratio, status: "bocor_total" };
}

/** BD lead priority (PRD §2.4, LOCKED default): frequency × GMV. */
export function leadPriority(frequency: number, totalGmv: number): number {
  return frequency * totalGmv;
}

export type ShopDealState = "active" | "expired" | "none";

/**
 * A shop counts as "ber-deal aktif" when it is in the cooperating-shops master
 * and its deal has not passed deal_end. deal_end is maintained internally
 * (brand_deals.exp_date) — a master shop without one is treated as active.
 * Expired deals push the shop's transactions to LEAD (re-deal opportunity).
 *
 * `hasAgencyGmv`: a shop that recorded agency-link (TAP) GMV this period is
 * definitionally partnered, so it is treated as active even when the master
 * hasn't been refreshed with it yet — otherwise its real leakage would be
 * misfiled as a BD lead and never surfaced.
 */
export function shopDealState(
  shop: { deal_end: string | null } | undefined,
  asOf: string,
  hasAgencyGmv = false
): ShopDealState {
  if (!shop) return hasAgencyGmv ? "active" : "none";
  if (shop.deal_end && shop.deal_end < asOf) return "expired";
  return "active";
}

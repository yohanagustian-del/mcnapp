import type { McnRow, TapRow } from "@/lib/ingest/schema";
import {
  allocateAgencyGmv,
  classifyPairStatus,
  leadPriority,
  rollupCreatorStatus,
  shopDealState,
  type LinkStatus,
  type ShopDealState,
} from "./classify";

/**
 * M4 link-leakage COMPUTE core — pure, deterministic, 0 LLM.
 *
 * This is the in-platform replacement for the external "Agency Leaked Generator"
 * artifact (an HTML tool each CM ran weekly, then uploaded its Excel output to
 * /ingest Lane 2). Same three inputs as the artifact — MCN report (all
 * transactions), TAP report (via agency link), and the partnered-shop master —
 * but the master can now come from the platform's own `cooperating_shops` table
 * instead of a third file, which also brings `deal_end` into play (a shop whose
 * deal already expired becomes a BD lead + alert; the artifact could not do that).
 *
 * Why pure functions over already-parsed rows: /ingest Lane 1 parses the very
 * same MCN+TAP files for the performance aggregates, so it hands its parsed rows
 * straight to this module — the weekly files are never parsed twice, and there is
 * exactly ONE leak formula on the platform (CLAUDE.md #4).
 *
 * GRANULARITY (interview decision, final): the OFFICIAL leaked figure is joined
 * per (product_id, shop_id) as CLAUDE.md #5 mandates —
 *     gmv_bocor = Σ over pairs on ber-deal shops of max(0, gmv_all − gmv_tap)
 * and the artifact's per-SHOP figure is computed alongside it as a comparison
 * value (`gmvBocorShopBasis`) so the team can reconcile the new numbers with the
 * reports they already have. Per-shop is always ≤ per-product, because a shop
 * where TAP exceeds MCN for one product can no longer mask a leak on another.
 */

/** Sub-rupiah differences are rounding noise, not leakage (matches classify.ts). */
const EPSILON = 1;

/** One partnered-shop master entry (from cooperating_shops or an uploaded master file). */
export interface MasterShopEntry {
  shopId: string;
  shopName: string | null;
  dealId: string | null;
  /** Known only for DB-sourced masters (an uploaded master file carries no deal_end). */
  dealEnd: string | null;
}

export interface LeakComputeInput {
  mcnRows: McnRow[];
  /** Empty ⇒ leak cannot be measured; callers must refuse to run (see runLeakAnalysis). */
  tapRows: TapRow[];
  /** Partnered shop master keyed by normalized shop id (see normalizeShopId). */
  master: Map<string, MasterShopEntry>;
  /** Week key = period start (ISO yyyy-mm-dd); also the as-of date for deal expiry. */
  week: string;
  /** app_config m4.bocor_sebagian / m4.bocor_total — never hardcoded. */
  thresholds: { sebagian: number; total: number };
}

/** Per-creator weekly rollup (→ creator_link_status). */
export interface CreatorLeakRollup {
  /** Username exactly as printed in the MCN file (resolved to creators.id by the caller). */
  creatorName: string;
  /** Affiliate GMV across ALL shops. */
  gmvAffiliateTotal: number;
  /** Agency-link (TAP) GMV attributed to this creator. */
  gmvTap: number;
  /** MCN affiliate GMV on ber-deal (partnered) shops = ratio denominator. */
  gmvDealTotal: number;
  /** OFFICIAL leaked GMV, joined per (product_id, shop_id) — CLAUDE.md #5. */
  gmvBocor: number;
  /** Comparison figure using the artifact's per-shop join (always ≤ gmvBocor). */
  gmvBocorShopBasis: number;
  leakRatio: number | null;
  leakRatioShopBasis: number | null;
  linkStatus: LinkStatus;
  /** GMV on shops WITHOUT an active deal → BizDev opportunity. */
  bdOpportunityGmv: number;
  directGmv: number;
  /** gmvTap / gmvAffiliateTotal (the artifact's "Eff %"); null when no GMV at all. */
  effectiveness: number | null;
  partneredShops: number;
  nonPartneredShops: number;
}

/** One leaking (creator × shop × product) row — CSV backup only, never persisted (decision: rollup saja). */
export interface LeakDetailRow {
  creatorName: string;
  shopId: string;
  shopName: string | null;
  productId: string;
  productName: string | null;
  level1Category: string | null;
  level2Category: string | null;
  gmvAll: number;
  gmvTap: number;
  gmvBocor: number;
  linkStatus: LinkStatus;
}

/** One BD opportunity shop (no active deal) → bd_leads + CSV. */
export interface BdOpportunityShop {
  shopId: string;
  shopName: string | null;
  level1Category: string | null;
  level2Category: string | null;
  gmv: number;
  /** Creator usernames driving that GMV, biggest first. */
  creators: string[];
  products: number;
  /** 'none' = never in the master; 'expired' = master deal already past deal_end. */
  dealState: Extract<ShopDealState, "none" | "expired">;
  /** frequency × GMV (PRD §2.4) with frequency = number of creators. */
  priorityScore: number;
}

export interface LeakTotals {
  gmvAffiliateTotal: number;
  gmvTap: number;
  gmvDealTotal: number;
  gmvBocor: number;
  gmvBocorShopBasis: number;
  gmvBdOpportunity: number;
  directGmv: number;
}

export interface ExpiredDealShop {
  shopId: string;
  shopName: string | null;
  dealId: string | null;
  dealEnd: string | null;
  gmv: number;
}

export interface LeakComputeResult {
  /** Sorted by gmvBocor desc (same ordering the artifact's report used). */
  creators: CreatorLeakRollup[];
  /** Sorted by gmvBocor desc. */
  detail: LeakDetailRow[];
  /** Sorted by gmv desc. */
  bdShops: BdOpportunityShop[];
  totals: LeakTotals;
  /** Shops that transacted this week although their master deal already expired. */
  expiredShops: ExpiredDealShop[];
  /** Shop ids treated as ber-deal this week (master ∪ shops with TAP GMV). */
  partneredShopIds: string[];
  /** TAP rows whose creator is absent from the MCN file (file mismatch signal). */
  tapOnlyCreators: string[];
  /** Notes surfaced to the uploader (never thrown): TAP without creator column, ... */
  warnings: string[];
}

/**
 * Canonical shop-id key. Platform exports print the 19-digit id as text, but a
 * master spreadsheet may carry stray spaces/apostrophes ("'1739...") — comparing
 * digits-only makes the join immune to that without ever matching two different
 * shops (ids are numeric by construction). A non-numeric id falls back to the
 * lowercased raw string.
 */
export function normalizeShopId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : raw.trim().toLowerCase();
}

/** Creator-name key: usernames are case-insensitive across MCN/TAP exports. */
const creatorKey = (name: string) => name.trim().toLowerCase();

const pairKey = (productId: string, shopId: string) => `${productId}|${normalizeShopId(shopId)}`;

interface CreatorAcc {
  creatorName: string;
  gmvAffiliateTotal: number;
  directGmv: number;
  gmvDealTotal: number;
  bdOpportunityGmv: number;
  /** (product,shop) pairs on ber-deal shops only — the leak basis. */
  pairs: Map<string, { productId: string; shopId: string; gmv: number }>;
  /** ber-deal shop → MCN GMV (per-shop comparison basis). */
  dealShops: Map<string, number>;
  nonDealShops: Set<string>;
}

interface BdAcc {
  shopId: string;
  gmv: number;
  creators: Map<string, number>;
  products: Set<string>;
  catGmv: Map<string, number>;
  dealState: Extract<ShopDealState, "none" | "expired">;
}

/**
 * Computes the whole weekly leak picture from the two parsed platform reports plus
 * the partnered-shop master. No I/O, no clock, no randomness — same inputs always
 * yield the same output (unit-tested in __tests__/leak-compute.test.ts).
 */
export function computeLeak(input: LeakComputeInput): LeakComputeResult {
  const { mcnRows, tapRows, master, week, thresholds } = input;
  const warnings: string[] = [];

  // ---- 1. TAP aggregates (agency-link GMV actually captured) ----
  const tapByCreator = new Map<string, number>();
  const tapPairByCreator = new Map<string, number>(); // `${creator}|${pair}`
  const tapPairUnattributed = new Map<string, number>(); // pair (TAP row without creator name)
  const tapShopByCreator = new Map<string, number>(); // `${creator}|${shop}`
  const tapShopUnattributed = new Map<string, number>();
  const tapShopIds = new Set<string>(); // shops with TAP GMV > 0 ⇒ definitionally partnered
  let tapRowsWithoutCreator = 0;

  for (const t of tapRows) {
    const shop = normalizeShopId(t.shopId);
    const pair = pairKey(t.productId, t.shopId);
    const gmv = t.affiliateGmv;
    if (gmv > 0) tapShopIds.add(shop);
    const ck = creatorKey(t.creatorName);
    if (ck === "") {
      tapRowsWithoutCreator++;
      tapPairUnattributed.set(pair, (tapPairUnattributed.get(pair) ?? 0) + gmv);
      tapShopUnattributed.set(shop, (tapShopUnattributed.get(shop) ?? 0) + gmv);
      continue;
    }
    tapByCreator.set(ck, (tapByCreator.get(ck) ?? 0) + gmv);
    tapPairByCreator.set(`${ck}|${pair}`, (tapPairByCreator.get(`${ck}|${pair}`) ?? 0) + gmv);
    tapShopByCreator.set(`${ck}|${shop}`, (tapShopByCreator.get(`${ck}|${shop}`) ?? 0) + gmv);
  }
  if (tapRowsWithoutCreator > 0) {
    warnings.push(
      `${tapRowsWithoutCreator} baris TAP tanpa nama kreator — GMV-nya dialokasikan proporsional ` +
        `ke kreator yang mempromosikan produk/shop yang sama (sesuai aturan alokasi M4).`
    );
  }

  // ---- 2. Shop deal state (master ∪ shops with TAP GMV) ----
  const shopState = new Map<string, ShopDealState>();
  const stateOf = (rawShopId: string): ShopDealState => {
    const shop = normalizeShopId(rawShopId);
    const cached = shopState.get(shop);
    if (cached) return cached;
    const entry = master.get(shop);
    // Invariant preserved from the M4 engine: a shop with TAP GMV this period is
    // partnered even when the master lags behind, otherwise its real leakage
    // would be misfiled as a BD lead and never surfaced.
    const state = shopDealState(
      entry ? { deal_end: entry.dealEnd } : undefined,
      week,
      tapShopIds.has(shop)
    );
    shopState.set(shop, state);
    return state;
  };

  // ---- 3. MCN pass: per-creator accumulation + BD aggregation + name maps ----
  const creators = new Map<string, CreatorAcc>();
  const pairGmvAllCreators = new Map<string, number>();
  const shopGmvAllCreators = new Map<string, number>();
  const bd = new Map<string, BdAcc>();
  const shopNameById = new Map<string, string | null>();
  const productNameById = new Map<string, string | null>();
  const productCatById = new Map<string, { cat1: string | null; cat2: string | null }>();
  const expiredGmv = new Map<string, number>();
  let mcnRowsWithoutCreator = 0;

  for (const r of mcnRows) {
    const shop = normalizeShopId(r.shopId);
    if (!shopNameById.has(shop)) shopNameById.set(shop, r.shopName ?? null);
    if (!productNameById.has(r.productId)) productNameById.set(r.productId, r.productInfo ?? null);
    if (!productCatById.has(r.productId)) {
      productCatById.set(r.productId, { cat1: r.level1Category, cat2: r.level2Category });
    }

    const ck = creatorKey(r.creatorName);
    if (ck === "") {
      mcnRowsWithoutCreator++;
      continue;
    }
    const acc =
      creators.get(ck) ??
      ({
        creatorName: r.creatorName.trim(),
        gmvAffiliateTotal: 0,
        directGmv: 0,
        gmvDealTotal: 0,
        bdOpportunityGmv: 0,
        pairs: new Map(),
        dealShops: new Map(),
        nonDealShops: new Set(),
      } satisfies CreatorAcc);
    creators.set(ck, acc);

    acc.gmvAffiliateTotal += r.affiliateGmv;
    acc.directGmv += r.directGmv;

    const state = stateOf(r.shopId);
    if (state === "active") {
      acc.gmvDealTotal += r.affiliateGmv;
      acc.dealShops.set(shop, (acc.dealShops.get(shop) ?? 0) + r.affiliateGmv);
      const pk = pairKey(r.productId, r.shopId);
      const cur = acc.pairs.get(pk);
      if (cur) cur.gmv += r.affiliateGmv;
      else acc.pairs.set(pk, { productId: r.productId, shopId: shop, gmv: r.affiliateGmv });
      pairGmvAllCreators.set(pk, (pairGmvAllCreators.get(pk) ?? 0) + r.affiliateGmv);
      shopGmvAllCreators.set(shop, (shopGmvAllCreators.get(shop) ?? 0) + r.affiliateGmv);
    } else {
      acc.bdOpportunityGmv += r.affiliateGmv;
      acc.nonDealShops.add(shop);
      if (state === "expired") {
        expiredGmv.set(shop, (expiredGmv.get(shop) ?? 0) + r.affiliateGmv);
      }
      if (r.affiliateGmv > 0) {
        const b =
          bd.get(shop) ??
          ({
            shopId: shop,
            gmv: 0,
            creators: new Map(),
            products: new Set(),
            catGmv: new Map(),
            dealState: state,
          } satisfies BdAcc);
        bd.set(shop, b);
        b.gmv += r.affiliateGmv;
        b.creators.set(r.creatorName.trim(), (b.creators.get(r.creatorName.trim()) ?? 0) + r.affiliateGmv);
        b.products.add(r.productId);
        const catk = `${r.level1Category ?? ""}||${r.level2Category ?? ""}`;
        b.catGmv.set(catk, (b.catGmv.get(catk) ?? 0) + r.affiliateGmv);
      }
    }
  }
  if (mcnRowsWithoutCreator > 0) {
    warnings.push(
      `${mcnRowsWithoutCreator} baris MCN tanpa nama kreator dilewati (tidak bisa dirollup per kreator).`
    );
  }

  // ---- 4. Per-creator leak (product basis = official, shop basis = comparison) ----
  const detail: LeakDetailRow[] = [];
  const rollups: CreatorLeakRollup[] = [];

  for (const [ck, acc] of creators) {
    let gmvBocor = 0;
    for (const p of acc.pairs.values()) {
      const pk = `${p.productId}|${p.shopId}`;
      const attributed = tapPairByCreator.get(`${ck}|${pk}`) ?? 0;
      // TAP rows without a creator column: split across the creators of the pair
      // proportionally to their MCN share (single-creator file ⇒ share = 1).
      const unattributed = allocateAgencyGmv(
        p.gmv,
        pairGmvAllCreators.get(pk) ?? 0,
        tapPairUnattributed.get(pk) ?? 0
      );
      const tapForPair = attributed + unattributed;
      const bocor = Math.max(p.gmv - tapForPair, 0);
      gmvBocor += bocor;
      if (bocor > EPSILON) {
        const cat = productCatById.get(p.productId);
        detail.push({
          creatorName: acc.creatorName,
          shopId: p.shopId,
          shopName: shopNameById.get(p.shopId) ?? null,
          productId: p.productId,
          productName: productNameById.get(p.productId) ?? null,
          level1Category: cat?.cat1 ?? null,
          level2Category: cat?.cat2 ?? null,
          gmvAll: p.gmv,
          gmvTap: tapForPair,
          gmvBocor: bocor,
          linkStatus: classifyPairStatus(p.gmv, tapForPair),
        });
      }
    }

    let gmvBocorShopBasis = 0;
    for (const [shop, shopGmv] of acc.dealShops) {
      const attributed = tapShopByCreator.get(`${ck}|${shop}`) ?? 0;
      const unattributed = allocateAgencyGmv(
        shopGmv,
        shopGmvAllCreators.get(shop) ?? 0,
        tapShopUnattributed.get(shop) ?? 0
      );
      gmvBocorShopBasis += Math.max(shopGmv - (attributed + unattributed), 0);
    }

    const { leakRatio, status } = rollupCreatorStatus(acc.gmvDealTotal, gmvBocor, thresholds);
    const shopBasis = rollupCreatorStatus(acc.gmvDealTotal, gmvBocorShopBasis, thresholds);
    const gmvTap = tapByCreator.get(ck) ?? 0;

    rollups.push({
      creatorName: acc.creatorName,
      gmvAffiliateTotal: acc.gmvAffiliateTotal,
      gmvTap,
      gmvDealTotal: acc.gmvDealTotal,
      gmvBocor,
      gmvBocorShopBasis,
      leakRatio,
      leakRatioShopBasis: shopBasis.leakRatio,
      linkStatus: status,
      bdOpportunityGmv: acc.bdOpportunityGmv,
      directGmv: acc.directGmv,
      effectiveness: acc.gmvAffiliateTotal > 0 ? gmvTap / acc.gmvAffiliateTotal : null,
      partneredShops: acc.dealShops.size,
      nonPartneredShops: acc.nonDealShops.size,
    });
  }

  rollups.sort((a, b) => b.gmvBocor - a.gmvBocor);
  detail.sort((a, b) => b.gmvBocor - a.gmvBocor);

  // ---- 5. BD opportunity shops ----
  const bdShops: BdOpportunityShop[] = [...bd.values()].map((b) => {
    const topCat = [...b.catGmv.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "||";
    const [cat1, cat2] = topCat.split("||");
    const creatorsSorted = [...b.creators.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n);
    return {
      shopId: b.shopId,
      shopName: shopNameById.get(b.shopId) ?? null,
      level1Category: cat1 || null,
      level2Category: cat2 || null,
      gmv: b.gmv,
      creators: creatorsSorted,
      products: b.products.size,
      dealState: b.dealState,
      priorityScore: leadPriority(creatorsSorted.length, b.gmv),
    };
  });
  bdShops.sort((a, b) => b.gmv - a.gmv);

  // ---- 6. Expired-deal shops that still transacted (hidden leakage → alert) ----
  const expiredShops: ExpiredDealShop[] = [...expiredGmv.entries()]
    .map(([shop, gmv]) => {
      const entry = master.get(shop);
      return {
        shopId: shop,
        shopName: entry?.shopName ?? shopNameById.get(shop) ?? null,
        dealId: entry?.dealId ?? null,
        dealEnd: entry?.dealEnd ?? null,
        gmv,
      };
    })
    .sort((a, b) => b.gmv - a.gmv);

  // ---- 7. Totals + parity checks ----
  const totals: LeakTotals = {
    gmvAffiliateTotal: sum(rollups, (r) => r.gmvAffiliateTotal),
    gmvTap: sum(rollups, (r) => r.gmvTap),
    gmvDealTotal: sum(rollups, (r) => r.gmvDealTotal),
    gmvBocor: sum(rollups, (r) => r.gmvBocor),
    gmvBocorShopBasis: sum(rollups, (r) => r.gmvBocorShopBasis),
    gmvBdOpportunity: sum(rollups, (r) => r.bdOpportunityGmv),
    directGmv: sum(rollups, (r) => r.directGmv),
  };

  const mcnCreatorKeys = new Set(creators.keys());
  const tapOnlyCreators = [...tapByCreator.keys()].filter((k) => !mcnCreatorKeys.has(k));
  if (tapOnlyCreators.length > 0) {
    warnings.push(
      `${tapOnlyCreators.length} kreator ada di file TAP tapi tidak ada di file MCN ` +
        `(${tapOnlyCreators.slice(0, 5).join(", ")}${tapOnlyCreators.length > 5 ? ", …" : ""}) — ` +
        `cek apakah kedua file dari periode & CM yang sama.`
    );
  }

  const partneredShopIds = [...shopState.entries()]
    .filter(([, s]) => s === "active")
    .map(([shop]) => shop);

  return {
    creators: rollups,
    detail,
    bdShops,
    totals,
    expiredShops,
    partneredShopIds,
    tapOnlyCreators,
    warnings,
  };
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, r) => acc + pick(r), 0);
}

"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { parseCommission } from "@/lib/utils/commission";
import {
  aggregateFromSubcatSegmentRows,
  priceSegmentOf,
  projectGmvRange,
  liveShareOf,
  PROJECTION_DISCLAIMER,
  type PriceSegment,
  type SubcatSegmentGmvRow,
} from "@/lib/projection/gmv";
import { loadProjectionConfig, windowStart } from "@/lib/projection/project-gmv";
import {
  commissionRange,
  matchCampaigns,
  rankCampaigns,
  type CampaignCandidate,
  type CreatorMatchProfile,
  type RankWeights,
  type RateRange,
} from "@/lib/m5/match";

export interface MatchingSuggestion {
  dealId: string;
  brandName: string;
  campaignName: string | null;
  shopId: string | null;
  matchedSubcat: string;
  segment: PriceSegment | null;
  segmentMatch: boolean;
  score: number;
  gmvMin: number;
  gmvMax: number;
  komisiMin: number | null; // null = rate perlu review
  komisiMax: number | null;
  hasAgencyLink: boolean; // SKU/shop sudah ber-agency-link MEA (M4)
}

export interface MatchingResult {
  ok: boolean;
  message: string;
  creatorId: string;
  creatorName: string;
  windowStart: string;
  linkStatus: string | null; // latest M4 rollup status for context
  suggestions: MatchingSuggestion[];
  /** Shops ber-deal yang dipromosikan creator TANPA lewat link agency (M4 §6.5b). */
  outsideAgency: { shopId: string; productRef: string | null; status: string }[];
  disclaimer: string;
}

interface DealRow {
  id: string;
  brand_name: string;
  campaign_name: string | null;
  shop_id: string | null;
  niche: string | null;
  avg_price: number | null;
  komisi_kreator_pct: number | null;
  komisi_kreator_raw: string | null;
  komisi_mea_pct: number | null;
  komisi_mea_raw: string | null;
  status: string | null;
  diterima_ditolak: string | null;
  exp_date: string | null;
  deal_end: string | null;
}

const toRate = (pct: number | null, raw: string | null): RateRange | null => {
  if (pct !== null && Number.isFinite(Number(pct))) return { min: Number(pct), max: Number(pct) };
  const parsed = parseCommission(raw);
  return parsed ? { min: parsed.min, max: parsed.max } : null;
};

/**
 * M5 matching engine (PRD Module 05 §2.2–2.3, 0 token AI):
 * filter subcat (level-2) → prioritize proven price segment → weighted ranking
 * (balanced, tunable) → potensi komisi = projectGmv (shared engine) × rate (range).
 * Suggestions are persisted to matching_runs (PRD §6.6: ukur efektivitas + baseline
 * "creator ambil SKU lain"), and agency-link context from M4 is surfaced (§6.5).
 */
export async function runMatching(
  _prev: MatchingResult | null,
  formData: FormData
): Promise<MatchingResult> {
  const actor = await requirePermission("m5.run");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  if (!creatorId) throw new Error("Pilih creator terlebih dahulu");

  const admin = createAdminClient();
  const [cfg, weights] = await Promise.all([
    loadProjectionConfig(),
    getConfig<RankWeights>("m5.rank_weights"),
  ]);

  const { data: creator } = await admin
    .from("creators")
    .select("id, name, level, niche")
    .eq("id", creatorId)
    .maybeSingle();
  if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan`);

  const cutoff = windowStart(cfg.windowDays);
  const today = new Date().toISOString().slice(0, 10);

  // ---- creator profile from creator_subcat_segment_gmv (Module 0.5 Fase 2) ----
  // Pre-aggregated at ingest time (creator × level2 category × price segment);
  // replaces a fresh aggregateHistory() pass over transactions_all, which is
  // dropped after ingest (Module 0.5 §2.7) and would silently go empty.
  const history = await fetchAll<SubcatSegmentGmvRow>(
    admin,
    "creator_subcat_segment_gmv",
    "creator_id, level2_category, price_segment, gmv, live_gmv",
    (q) => q.eq("creator_id", creatorId).gte("window_end", cutoff)
  );
  if (history.length === 0) {
    return {
      ok: false,
      message: `Tidak ada histori transaksi ${cfg.windowDays} hari untuk ${creator.name} — upload data platform (/ingest) dulu.`,
      creatorId, creatorName: creator.name, windowStart: cutoff,
      linkStatus: null, suggestions: [], outsideAgency: [], disclaimer: PROJECTION_DISCLAIMER,
    };
  }

  const agg = aggregateFromSubcatSegmentRows(history);
  const prefix = `${creatorId}|`;
  const subcatGmv = new Map<string, number>();
  for (const [k, v] of agg.bySubcat) if (k.startsWith(prefix)) subcatGmv.set(k.slice(prefix.length), v);
  const slotGmv = new Map<string, number>();
  for (const [k, v] of agg.bySlot) if (k.startsWith(prefix)) slotGmv.set(k.slice(prefix.length), v);

  const totals = agg.totals.get(creatorId);
  // gpm (GMV per 1000 views) has no equivalent column on creator_subcat_segment_gmv
  // (views aren't tracked at that grain) — null here, which m5/match.ts already
  // handles gracefully (falls back to a neutral 0.5 conversion score).
  const profile: CreatorMatchProfile = {
    creatorId,
    level: creator.level,
    subcatGmv,
    slotGmv,
    gpm: null,
    liveShare: liveShareOf(totals),
  };

  // ---- campaign candidates from brand_deals (+ shop master categories) ----
  const deals = await fetchAll<DealRow>(
    admin,
    "brand_deals",
    "id, brand_name, campaign_name, shop_id, niche, avg_price, komisi_kreator_pct, komisi_kreator_raw, komisi_mea_pct, komisi_mea_raw, status, diterima_ditolak, exp_date, deal_end",
    (q) => q
  );
  const active = deals.filter((d) => {
    if (d.diterima_ditolak === "ditolak") return false;
    if (d.status === "done") return false;
    const end = d.deal_end ?? d.exp_date;
    return !end || end >= today;
  });

  const shopIds = [...new Set(active.map((d) => d.shop_id).filter(Boolean))] as string[];
  const shops = shopIds.length
    ? await fetchAll<{ shop_id: string; level2_categories: string | null }>(
        admin, "cooperating_shops", "shop_id, level2_categories", (q) => q.in("shop_id", shopIds))
    : [];
  const shopCats = new Map(shops.map((s) => [s.shop_id, s.level2_categories]));

  const candidates: CampaignCandidate[] = active.map((d) => {
    const cats = [
      ...(d.niche ? [d.niche] : []),
      ...((d.shop_id && shopCats.get(d.shop_id)) ?? "").split(",").map((c) => c.trim()).filter(Boolean),
    ];
    return {
      dealId: d.id,
      brandName: d.brand_name,
      campaignName: d.campaign_name,
      shopId: d.shop_id,
      subCategories: cats,
      segment: d.avg_price && d.avg_price > 0 ? priceSegmentOf(Number(d.avg_price), cfg.bounds) : null,
      rateKreator: toRate(d.komisi_kreator_pct, d.komisi_kreator_raw),
      rateMea: toRate(d.komisi_mea_pct, d.komisi_mea_raw),
    };
  });

  const ranked = rankCampaigns(matchCampaigns(profile, candidates), profile, weights);

  // ---- M4 context: agency links & leak status (PRD M5 §6.5) ----
  const links = await fetchAll<{ shop_id: string; product_ref: string | null; link_status: string; source_upload_week: string | null }>(
    admin, "agency_links", "shop_id, product_ref, link_status, source_upload_week",
    (q) => q.eq("creator_id", creatorId)
  );
  const latestWeek = links.reduce<string | null>(
    (max, l) => (l.source_upload_week && (!max || l.source_upload_week > max) ? l.source_upload_week : max), null);
  const latestLinks = links.filter((l) => l.source_upload_week === latestWeek);
  const linkedShops = new Set(latestLinks.filter((l) => l.link_status === "via_agency").map((l) => l.shop_id));
  const outsideAgency = latestLinks
    .filter((l) => l.link_status === "bocor_sebagian" || l.link_status === "bocor_total")
    .slice(0, 20)
    .map((l) => ({ shopId: l.shop_id, productRef: l.product_ref, status: l.link_status }));

  const { data: cls } = await admin
    .from("creator_link_status")
    .select("link_status, week")
    .eq("creator_id", creatorId)
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ---- potensi komisi via the SHARED projection formula (CLAUDE.md #8) ----
  const suggestions: MatchingSuggestion[] = ranked.slice(0, 20).map((m) => {
    const proj = projectGmvRange(m.basisGmv, creator.level, cfg);
    const komisi = commissionRange(proj, m.rateKreator);
    return {
      dealId: m.dealId,
      brandName: m.brandName,
      campaignName: m.campaignName,
      shopId: m.shopId,
      matchedSubcat: m.matchedSubcat,
      segment: m.segment,
      segmentMatch: m.segmentMatch,
      score: m.score,
      gmvMin: proj.min,
      gmvMax: proj.max,
      komisiMin: komisi?.min ?? null,
      komisiMax: komisi?.max ?? null,
      hasAgencyLink: m.shopId ? linkedShops.has(m.shopId) : false,
    };
  });

  // ---- persist run (matching_runs, engine-only write) + audit ----
  const { error: runError } = await admin.from("matching_runs").insert({
    creator_id: creatorId,
    run_by: actor.id,
    window_start: cutoff,
    params: { weights, window_days: cfg.windowDays },
    results: suggestions,
  });
  if (runError) throw new Error(`Gagal menyimpan hasil matching: ${runError.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "m5.run_matching",
    entityType: "matching_runs",
    entityId: creatorId,
    after: { window_start: cutoff, candidates: candidates.length, suggestions: suggestions.length },
    type: "auto",
  });

  return {
    ok: true,
    message: suggestions.length
      ? `${suggestions.length} saran campaign untuk ${creator.name} (dari ${candidates.length} campaign aktif).`
      : `Tidak ada campaign aktif yang cocok dengan sub-kategori historis ${creator.name}.`,
    creatorId,
    creatorName: creator.name,
    windowStart: cutoff,
    linkStatus: cls?.link_status ?? null,
    suggestions,
    outsideAgency,
    disclaimer: PROJECTION_DISCLAIMER,
  };
}

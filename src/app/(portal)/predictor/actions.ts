"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { parseRupiah } from "@/lib/utils/rupiah";
import {
  aggregateFromSubcatSegmentRows,
  liveShareOf,
  priceSegmentOf,
  projectGmvRange,
  slotKey,
  subcatKey,
  PROJECTION_DISCLAIMER,
  type PriceSegment,
} from "@/lib/projection/gmv";
import {
  loadProjectionConfig,
  fetchWindowHistory,
  windowStart,
} from "@/lib/projection/project-gmv";

export interface PredictorCreatorRow {
  creatorId: string;
  name: string;
  level: number | null;
  /** GMV window pada (sub-kategori, segmen) — basis proyeksi. */
  basisGmv: number;
  /** GMV total creator di window (semua kategori) — tampilan pendukung. */
  totalGmv: number;
  /** % GMV dari live (sinyal kualitas). */
  liveShare: number | null;
  gmvMin: number;
  gmvMax: number;
  /** True = kandidat fallback: sub-kategori sama, segmen harga berbeda (confidence lebih rendah). */
  isFallback: boolean;
}

export interface PredictorResult {
  ok: boolean;
  message: string;
  subCategory: string;
  segment: PriceSegment;
  durationDays: number;
  windowStart: string;
  totalMin: number; // agregasi kandidat relevan (non-fallback)
  totalMax: number;
  relevantCount: number;
  creators: PredictorCreatorRow[];
  disclaimer: string;
}

/**
 * M6 BD Deal Value Predictor (PRD Module 06 §2.2–2.3, 0 token AI):
 * filter creator dengan GMV window pada (sub-kategori level-2, segmen harga) yang
 * sama dengan produk deal → proyeksi per creator via mesin proyeksi BERSAMA M5
 * (satu rumus) → agregasi = potensi GMV untuk brand. Fallback: bila kandidat
 * relevan < N (config), tampilkan creator sub-kategori sama di segmen lain
 * (ditandai, TIDAK ikut agregasi). TANPA komisi/income MEA (di luar scope M6).
 */
export async function runPrediction(
  _prev: PredictorResult | null,
  formData: FormData
): Promise<PredictorResult> {
  const actor = await requirePermission("m6.run");

  const subCategory = String(formData.get("sub_category") ?? "").trim();
  if (!subCategory) throw new Error("Sub-kategori (Level 2) wajib diisi");
  const price = parseRupiah(String(formData.get("price") ?? ""));
  if (price === null || price <= 0) throw new Error("Harga produk deal wajib diisi (Rupiah)");
  const durationDays = Number(formData.get("duration_days") ?? 0) || undefined;

  const admin = createAdminClient();
  const [cfg, minRelevant] = await Promise.all([
    loadProjectionConfig(),
    getConfig<number>("m6.min_relevant_creators"),
  ]);
  const segment = priceSegmentOf(price, cfg.bounds);
  const cutoff = windowStart(cfg.windowDays);
  const duration = durationDays ?? cfg.windowDays;

  // Whole-window history (all creators) from creator_subcat_segment_gmv
  // (Module 0.5 Fase 2 — pre-aggregated at ingest time; transactions_all is
  // dropped after ingest per §2.7, so a fresh aggregateHistory() pass over it
  // would silently see nothing once drop-raw runs).
  const rows = await fetchWindowHistory(cutoff);
  if (rows.length === 0) {
    return {
      ok: false,
      message: `Tidak ada data transaksi dalam window ${cfg.windowDays} hari — upload data platform (/ingest) dulu.`,
      subCategory, segment, durationDays: duration, windowStart: cutoff,
      totalMin: 0, totalMax: 0, relevantCount: 0, creators: [], disclaimer: PROJECTION_DISCLAIMER,
    };
  }
  const agg = aggregateFromSubcatSegmentRows(rows);

  // Relevant = proven GMV on the exact (subcat, segment) slot (PRD §2.3:
  // creator tanpa transaksi di sub-kategori target tidak dimasukkan).
  const relevantBasis = new Map<string, number>();
  const fallbackBasis = new Map<string, number>();
  for (const creatorId of agg.totals.keys()) {
    const slot = agg.bySlot.get(slotKey(creatorId, subCategory, segment)) ?? 0;
    if (slot > 0) {
      relevantBasis.set(creatorId, slot);
      continue;
    }
    const subTotal = agg.bySubcat.get(subcatKey(creatorId, subCategory)) ?? 0;
    if (subTotal > 0) fallbackBasis.set(creatorId, subTotal);
  }

  const includeFallback = relevantBasis.size < minRelevant;
  const pickedIds = [
    ...relevantBasis.keys(),
    ...(includeFallback ? [...fallbackBasis.keys()] : []),
  ];
  if (pickedIds.length === 0) {
    return {
      ok: false,
      message: `Tidak ada creator dengan transaksi ${cfg.windowDays} hari di sub-kategori "${subCategory}".`,
      subCategory, segment, durationDays: duration, windowStart: cutoff,
      totalMin: 0, totalMax: 0, relevantCount: 0, creators: [], disclaimer: PROJECTION_DISCLAIMER,
    };
  }

  const { data: creatorRows } = await admin
    .from("creators")
    .select("id, name, level")
    .in("id", pickedIds.slice(0, 500));
  const creatorById = new Map((creatorRows ?? []).map((c) => [c.id, c]));

  const buildRow = (creatorId: string, basis: number, isFallback: boolean): PredictorCreatorRow => {
    const meta = creatorById.get(creatorId);
    const totals = agg.totals.get(creatorId);
    const proj = projectGmvRange(basis, meta?.level ?? null, cfg, duration);
    return {
      creatorId,
      name: meta?.name ?? creatorId,
      level: meta?.level ?? null,
      basisGmv: basis,
      totalGmv: totals?.gmv ?? 0,
      liveShare: liveShareOf(totals),
      gmvMin: proj.min,
      gmvMax: proj.max,
      isFallback,
    };
  };

  const relevant = [...relevantBasis.entries()]
    .map(([id, basis]) => buildRow(id, basis, false))
    .sort((a, b) => b.basisGmv - a.basisGmv);
  const fallback = includeFallback
    ? [...fallbackBasis.entries()]
        .map(([id, basis]) => buildRow(id, basis, true))
        .sort((a, b) => b.basisGmv - a.basisGmv)
        .slice(0, 20)
    : [];

  // Deal aggregate = sum of RELEVANT creators only (fallback shown, not summed).
  const totalMin = relevant.reduce((s, c) => s + c.gmvMin, 0);
  const totalMax = relevant.reduce((s, c) => s + c.gmvMax, 0);
  const creators = [...relevant, ...fallback].slice(0, 60);

  const input = { sub_category: subCategory, price, segment, duration_days: duration, window_start: cutoff };
  const { error: saveError } = await admin.from("deal_projections").insert({
    run_by: actor.id,
    input,
    result: { total_min: totalMin, total_max: totalMax, relevant: relevant.length, fallback: fallback.length },
  });
  if (saveError) throw new Error(`Gagal menyimpan proyeksi: ${saveError.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "m6.run_prediction",
    entityType: "deal_projections",
    entityId: subCategory,
    after: { ...input, total_min: totalMin, total_max: totalMax, relevant: relevant.length },
    type: "auto",
  });

  return {
    ok: true,
    message: includeFallback
      ? `Hanya ${relevant.length} creator relevan (< ${minRelevant}) — ${fallback.length} kandidat fallback segmen lain ditampilkan (tidak ikut agregasi).`
      : `${relevant.length} creator relevan di "${subCategory}" segmen ${segment}.`,
    subCategory,
    segment,
    durationDays: duration,
    windowStart: cutoff,
    totalMin,
    totalMax,
    relevantCount: relevant.length,
    creators,
    disclaimer: PROJECTION_DISCLAIMER,
  };
}

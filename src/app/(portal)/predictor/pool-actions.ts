"use server";

import { requirePermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { fetchWindowHistory, loadProjectionConfig, windowStart } from "@/lib/projection/project-gmv";
import type { PriceSegment } from "@/lib/projection/gmv";
import { averageRoas, type CreatorPoolRow, type DealType, type PredictorResult } from "@/lib/m6/predictor";

const SEGMENTS: PriceSegment[] = ["low", "entry", "sweet", "high", "premium"];

export interface CategoryOption {
  category: string;
  creatorCount: number;
}

/** Kategori (Level 2) dengan jumlah kreator ber-histori dalam window berjalan — untuk dropdown Setup Deal. */
export async function listPoolCategories(): Promise<{ categories: CategoryOption[]; windowDays: number }> {
  await requirePermission("m6.run");
  const cfg = await loadProjectionConfig();
  const rows = await fetchWindowHistory(windowStart(cfg.windowDays));

  const byCategory = new Map<string, Set<string>>();
  for (const r of rows) {
    const cat = r.level2_category?.trim();
    if (!cat || !r.creator_id || (r.gmv ?? 0) <= 0) continue;
    const set = byCategory.get(cat) ?? new Set<string>();
    set.add(r.creator_id);
    byCategory.set(cat, set);
  }

  const categories = [...byCategory.entries()]
    .map(([category, ids]) => ({ category, creatorCount: ids.size }))
    .sort((a, b) => b.creatorCount - a.creatorCount);

  return { categories, windowDays: cfg.windowDays };
}

export interface SegmentPool {
  segment: PriceSegment;
  totalGmv: number;
  rows: CreatorPoolRow[];
}

/**
 * Pool kreator per segmen untuk satu kategori — dipakai klien untuk mengisi
 * chip 5 segmen + tabel Creator Pool. Perhitungan proyeksi (compute()) sendiri
 * dijalankan di KLIEN dari data yang dikembalikan di sini (rumus HTML: aritmetika
 * ringan atas data pool, bukan query baru tiap slider — CLAUDE.md §B).
 */
export async function loadPoolForCategory(category: string): Promise<SegmentPool[]> {
  await requirePermission("m6.run");
  const cfg = await loadProjectionConfig();
  const rows = await fetchWindowHistory(windowStart(cfg.windowDays));
  const admin = createAdminClient();

  const perCreatorSegment = new Map<string, Map<PriceSegment, { gmv: number; liveGmv: number; orders: number }>>();
  for (const r of rows) {
    if (r.level2_category?.trim() !== category) continue;
    if (!r.creator_id || !r.price_segment) continue;
    const gmv = r.gmv ?? 0;
    if (gmv <= 0) continue;
    const segMap = perCreatorSegment.get(r.creator_id) ?? new Map();
    const acc = segMap.get(r.price_segment) ?? { gmv: 0, liveGmv: 0, orders: 0 };
    acc.gmv += gmv;
    acc.liveGmv += r.live_gmv ?? 0;
    acc.orders += r.orders ?? 0;
    segMap.set(r.price_segment, acc);
    perCreatorSegment.set(r.creator_id, segMap);
  }

  const creatorIds = [...perCreatorSegment.keys()];
  const creatorRows = creatorIds.length
    ? await fetchAll<{ id: string; name: string; username: string | null }>(
        admin,
        "creators",
        "id, name, username",
        (q) => q.in("id", creatorIds)
      )
    : [];
  const creatorMeta = new Map(creatorRows.map((c) => [c.id, c]));

  // Saran ROAS default (§B): rata-rata deal_live_sessions.roas>0, dicocokkan
  // ke kreator lewat username (best-effort — creator_name di sana adalah
  // teks bebas dari report BD, bukan FK).
  const roasRows = creatorIds.length
    ? await fetchAll<{ creator_name: string; roas: number | null }>(
        admin,
        "deal_live_sessions",
        "creator_name, roas",
        (q) => q.gt("roas", 0)
      )
    : [];
  const roasByNameKey = new Map<string, number[]>();
  for (const r of roasRows) {
    const key = r.creator_name?.trim().toLowerCase();
    if (!key || r.roas == null) continue;
    const list = roasByNameKey.get(key) ?? [];
    list.push(r.roas);
    roasByNameKey.set(key, list);
  }

  return SEGMENTS.map((segment) => {
    const poolRows: CreatorPoolRow[] = [];
    let totalGmv = 0;
    for (const [creatorId, segMap] of perCreatorSegment) {
      const cell = segMap.get(segment);
      if (!cell) continue;
      const meta = creatorMeta.get(creatorId);
      const username = meta?.username ?? meta?.name ?? creatorId;
      const roasRef = averageRoas(roasByNameKey.get(username.trim().toLowerCase()) ?? []);
      totalGmv += cell.gmv;
      poolRows.push({
        creatorId,
        username,
        gmvCell: cell.gmv,
        orders: cell.orders,
        liveShare: cell.gmv > 0 ? Math.min(cell.liveGmv / cell.gmv, 1) : null,
        roasRef,
      });
    }
    poolRows.sort((a, b) => b.gmvCell - a.gmvCell);
    return { segment, totalGmv, rows: poolRows };
  });
}

export interface SaveScenarioInput {
  dealType: DealType;
  brandName: string;
  category: string;
  segment: PriceSegment;
  selectedCreatorIds: string[];
  ramp: number;
  roas: number;
  budget: number;
  anchor: number;
  result: PredictorResult;
}

/** Simpan skenario (klik "Simpan Skenario", bukan tiap slider) — deal_projections + audit. */
export async function saveScenario(input: SaveScenarioInput): Promise<void> {
  const actor = await requirePermission("m6.run");
  const admin = createAdminClient();

  const record = {
    deal_type: input.dealType,
    brand_name: input.brandName || null,
    category: input.category,
    segment: input.segment,
    selected_creator_ids: input.selectedCreatorIds,
    ramp: input.ramp,
    roas: input.roas,
    budget: input.budget,
    anchor: input.anchor,
  };

  const { error } = await admin.from("deal_projections").insert({
    run_by: actor.id,
    input: record,
    result: input.result,
  });
  if (error) throw new Error(`Gagal menyimpan skenario: ${error.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "m6.run_prediction",
    entityType: "deal_projections",
    entityId: input.category,
    after: { ...record, likely: input.result.likely, confidence: input.result.confidence },
    type: "auto",
  });
}

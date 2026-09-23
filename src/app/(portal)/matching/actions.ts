"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { windowStart } from "@/lib/projection/project-gmv";
import { buildCreatorProductMatch, loadProductMatchConfig } from "@/lib/product-match/data";
import type { ProductMatchResult } from "@/lib/product-match/engine";

export interface MatchingActionResult {
  ok: boolean;
  message: string;
  creatorId: string;
  creatorName: string;
  result: ProductMatchResult;
}

/**
 * Creator Product Match (satu engine, CLAUDE.md §A) — pengganti M5 lama
 * (brand_deals scoring, dipensiunkan). `matching_runs` tetap ditulis untuk
 * jejak (PRD M5 §6.6), isinya sekarang hasil engine baru.
 */
export async function runMatching(
  _prev: MatchingActionResult | null,
  formData: FormData
): Promise<MatchingActionResult> {
  const actor = await requirePermission("m5.run");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  if (!creatorId) throw new Error("Pilih kreator terlebih dahulu");

  const admin = createAdminClient();
  const { data: creator } = await admin.from("creators").select("id, name").eq("id", creatorId).maybeSingle();
  if (!creator) throw new Error(`Kreator ${creatorId} tidak ditemukan`);

  const [config, result] = await Promise.all([loadProductMatchConfig(), buildCreatorProductMatch(creatorId)]);

  const { error: runError } = await admin.from("matching_runs").insert({
    creator_id: creatorId,
    run_by: actor.id,
    window_start: windowStart(config.windowDays),
    params: { engine: "product-match-v1", top_n: config.topN, window_days: config.windowDays },
    results: result,
  });
  if (runError) throw new Error(`Gagal menyimpan hasil matching: ${runError.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "m5.run_matching",
    entityType: "matching_runs",
    entityId: creatorId,
    after: { category_count: result.summary.categoryCount, total_gmv: result.summary.totalGmv },
    type: "auto",
  });

  return {
    ok: result.categories.length > 0,
    message: result.categories.length
      ? `${result.categories.length} kategori tercocokkan untuk ${creator.name}.`
      : `Tidak ada histori transaksi yang cukup untuk ${creator.name} dalam window ${config.windowDays} hari — upload data platform (/ingest) dulu.`,
    creatorId,
    creatorName: creator.name,
    result,
  };
}

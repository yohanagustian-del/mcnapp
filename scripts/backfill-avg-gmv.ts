/**
 * ONE-TIME BACKFILL (task A.4): recompute creators.gmv / gmv_live / gmv_video as
 * the AVERAGE OF MONTHLY TOTALS (src/lib/m8/weekly-growth.ts buildMonthlyAverages)
 * for every creator that has rows in creator_period_summary — same formula the
 * ingest pipeline now writes going forward (src/lib/ingest/run.ts autoFillCreators).
 * Needed once because existing creators.gmv/gmv_live/gmv_video were written by the
 * OLD "this batch's total" behavior and won't self-correct until each creator's
 * next weekly upload.
 *
 * Deterministic, 0 token AI (CLAUDE.md #1). Writes creators + audit_logs
 * (action "creator.backfill_avg_gmv", type "auto") — CLAUDE.md #2/#4.
 *
 * DO NOT RUN AUTOMATICALLY — the orchestrator/user runs this manually once.
 *
 * Run with:
 *   npx tsx scripts/backfill-avg-gmv.ts
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 * (same admin-client pattern as src/lib/ingest/__tests__/smoke.qa-manual.test.ts —
 * loaded manually below since this runs outside Next's env loading).
 */
import { readFileSync } from "fs";
import type { AvgMonthlyGmvInputRow } from "../src/lib/m8/weekly-growth";

// ---- Load .env.local the same way the smoke tests do (outside Next request scope) ----
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { writeAudit } = await import("../src/lib/audit");
  const { buildMonthlyAverages } = await import("../src/lib/m8/weekly-growth");

  const admin = createAdminClient();

  // ---- 1. Distinct creator_id in creator_period_summary ----
  const creatorIds = new Set<string>();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from("creator_period_summary")
        .select("creator_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Gagal membaca creator_period_summary: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) creatorIds.add(row.creator_id as string);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`Ditemukan ${creatorIds.size} creator dengan riwayat creator_period_summary.`);

  let updated = 0;
  let skippedNoChange = 0;
  let failed = 0;

  // ---- 2. Per-creator: full history -> monthly average -> update + audit ----
  for (const creatorId of creatorIds) {
    try {
      const { data: periodRows, error: periodError } = await admin
        .from("creator_period_summary")
        .select("creator_id, period_start, gmv_total, affiliate_live_gmv, affiliate_video_gmv, created_at")
        .eq("creator_id", creatorId);
      if (periodError) throw new Error(`Gagal membaca histori ${creatorId}: ${periodError.message}`);

      const inputRows: AvgMonthlyGmvInputRow[] = (periodRows ?? []).map((r) => ({
        creatorId: r.creator_id as string,
        periodStart: r.period_start as string,
        createdAt: r.created_at as string,
        gmvTotal: Number(r.gmv_total ?? 0),
        affiliateLiveGmv: Number(r.affiliate_live_gmv ?? 0),
        affiliateVideoGmv: Number(r.affiliate_video_gmv ?? 0),
      }));
      const avg = buildMonthlyAverages(inputRows);

      const { data: existing, error: existingError } = await admin
        .from("creators")
        .select("gmv, gmv_live, gmv_video")
        .eq("id", creatorId)
        .maybeSingle();
      if (existingError) throw new Error(`Gagal membaca creator ${creatorId}: ${existingError.message}`);
      if (!existing) {
        console.warn(`Creator ${creatorId} punya creator_period_summary tapi tidak ada di master creators — dilewati.`);
        continue;
      }

      const before = { gmv: existing.gmv, gmv_live: existing.gmv_live, gmv_video: existing.gmv_video };
      const after = { gmv: avg.gmv, gmv_live: avg.gmvLive, gmv_video: avg.gmvVideo };
      const unchanged =
        Number(before.gmv ?? 0) === after.gmv &&
        Number(before.gmv_live ?? 0) === after.gmv_live &&
        Number(before.gmv_video ?? 0) === after.gmv_video;
      if (unchanged) {
        skippedNoChange++;
        continue;
      }

      const { error: updateError } = await admin
        .from("creators")
        .update({ gmv: after.gmv, gmv_live: after.gmv_live, gmv_video: after.gmv_video })
        .eq("id", creatorId);
      if (updateError) throw new Error(`Gagal update creator ${creatorId}: ${updateError.message}`);

      await writeAudit({
        actorId: null,
        actorLabel: "system:backfill_avg_gmv",
        action: "creator.backfill_avg_gmv",
        entityType: "creators",
        entityId: creatorId,
        before,
        after: { ...after, months_counted: avg.monthsCounted },
        type: "auto",
      });

      updated++;
      console.log(`OK  ${creatorId}: gmv ${before.gmv} -> ${after.gmv} (avg dari ${avg.monthsCounted} bulan)`);
    } catch (e) {
      failed++;
      console.error(`GAGAL ${creatorId}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log("\n=== Backfill selesai ===");
  console.log(`Diupdate: ${updated}`);
  console.log(`Tidak berubah (dilewati): ${skippedNoChange}`);
  console.log(`Gagal: ${failed}`);
}

main().catch((e) => {
  console.error("Backfill gagal total:", e);
  process.exit(1);
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import {
  deriveJenisCreator, distinctCreatorNames, platformFromReportSource, rankTopNiches,
  resolveCreatorNames,
} from "@/lib/platform-csv";
import type { PriceBounds } from "@/lib/projection/gmv";
import { validateW1W5Period } from "@/lib/utils/date";
import { derivePeriod, parseMcnFile, parseTapFile, type ParseResult, type SkippedRow } from "./parse";
import { buildPeriodSummary, buildSubcatSegment, buildTopProducts } from "./aggregate";
import { MCN_COLUMNS, type McnRow, type TapRow } from "./schema";
import { upsertDerivedFromTap } from "@/lib/m10/products";
import {
  computeSharedAutoFillFields, fetchMonthlyAvgGmvByCreator, writeCreatorAutoFillUpdate,
} from "./creator-autofill";
import { runLeakAnalysis, type LeakAnalysisResult } from "@/lib/m4/leak-analysis";
import { recomputeCapabilityForBatch } from "@/lib/px/capability-recompute";
import { pushCoverageForBatch, type CoveragePushResult } from "@/lib/px/coverage-push";
// Retention lives in its own module (leak-retention.ts) so the leak analysis can
// import it without a cycle through this file; re-exported here for the existing
// importers of `enforceLeakRetention` from "./run".
export { enforceLeakRetention } from "./leak-retention";

export interface RunIngestInput {
  mcnFile: File;
  tapFile?: File | null;
  /**
   * Optional "Master Data Shop" file for the leak analysis (the third input of the
   * old external artifact). Omitted ⇒ the partnered-shop master is read from the
   * platform's own cooperating_shops table. Ignored when no TAP file is uploaded
   * (leak cannot be measured without TAP).
   */
  masterShopFile?: File | null;
  actorId: string;
}

export interface RunIngestResult {
  batchId: string;
  periodStart: string;
  periodEnd: string;
  rowsProcessedMcn: number;
  rowsProcessedTap: number;
  creatorsCount: number;
  createdProspects: string[];
  skipped: SkippedRow[];
  aggregateRows: { periodSummary: number; subcatSegment: number; topProducts: number };
  /** Always true: this pipeline is aggregates-only — raw rows are never written to the DB. */
  droppedRaw: boolean;
  /**
   * Weekly link-leakage analysis computed from the SAME parsed MCN+TAP rows
   * (src/lib/m4/leak-analysis.ts). Null when it could not run — see leakSkipped
   * (no TAP file) or leakError (analysis failed). A leak failure NEVER fails the
   * aggregate ingest: the batch stays 'processed' and the reason is reported here.
   */
  leak: LeakAnalysisResult | null;
  leakSkipped: string | null;
  leakError: string | null;
  /**
   * PX-M1: rows written by the capability recompute for this batch's creators, or
   * null when it didn't run (see capabilitySkipped/capabilityError). Never fails
   * the ingest — a recompute error is reported here, not thrown.
   */
  capability: number | null;
  capabilitySkipped: string | null;
  capabilityError: string | null;
  /**
   * PX-M3-A: result of pushing the FULL current coverage snapshot (all
   * creators, not just this batch — bridge.px_coverage_map() reads the whole
   * registry) to CDPS at the end of this ingest run. Null when it didn't run
   * (see coveragePushSkipped/coveragePushError). Never fails the ingest — a
   * push error (network, CDPS down, bad secret) is reported here, not thrown.
   */
  coveragePush: CoveragePushResult | null;
  coveragePushSkipped: string | null;
  coveragePushError: string | null;
}

/** sha256 of the raw file bytes — cheap provenance record in upload_batches (no row content kept). */
async function fileHash(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(buf).digest("hex");
}

/** Expected (normalized, English) headers this module reads from the MCN file. */
const MCN_EXPECTED_HEADERS = Object.values(MCN_COLUMNS);

/**
 * Builds a diagnostic message when parseMcnFile yields 0 rows despite the file
 * clearly having content (many skipped rows / raw headers detected). Previously
 * this surfaced as a misleading "Kolom Tanggal tidak terbaca" even when the real
 * cause was an unrecognized header set (e.g. an Indonesian-language export whose
 * headers aren't in MCN_HEADER_ALIASES yet). Lists a sample of headers actually
 * found vs. expected so the fix is obvious without reading source code.
 */
function describeMcnParseFailure(mcnParsed: ParseResult<McnRow>): string {
  const hasContent = mcnParsed.rawHeadersFound.length > 0 || mcnParsed.skipped.length > 0;
  if (!hasContent) {
    return "File MCN kosong atau tidak terbaca — pastikan file export platform asli (bukan file kosong/rusak).";
  }
  const found = mcnParsed.rawHeadersFound.slice(0, 8).join(", ") || "(tidak ada header terbaca)";
  const expected = MCN_EXPECTED_HEADERS.slice(0, 8).join(", ");
  return (
    `File MCN tidak menghasilkan baris data yang valid (${mcnParsed.skipped.length} baris dilewati). ` +
    `Kemungkinan header kolom tidak dikenali — header yang ditemukan di file: ${found}. ` +
    `Header yang diharapkan (setelah normalisasi): ${expected}. ` +
    `Cek apakah file menggunakan bahasa/format export platform yang berbeda.`
  );
}

/**
 * Shared ingest orchestrator (Module 0.5 §3.1 / BUILD_PLAN Fase 1) — aggregates-only,
 * drop-raw. Raw transaction rows are NEVER written to the DB: they are parsed,
 * aggregated in-memory, and discarded.
 *
 * Agency-leak analysis is back IN the platform (interview decision): the external
 * "Agency Leaked Generator" artifact's logic now lives in src/lib/m4/leak-compute.ts
 * and runs here (step 8) on the SAME parsed rows, so the weekly MCN+TAP files are
 * uploaded once and parsed once. Only the rollup is persisted; the per-product
 * detail becomes a CSV backup. Steps (best-effort ordering; Supabase JS has no
 * cross-table transaction):
 *   1. Parse MCN (+ optional TAP) file into internal rows; resolve creator names.
 *   2. upload_batches row, status='staging'. batch_id = `ingest:${periodStart}:${hash8}`
 *      (hash8 = first 8 hex chars of the MCN file's sha256) — unique per file CONTENT,
 *      not just per week, so two different CMs uploading different creator sets for
 *      the same week get two side-by-side batch_id rows instead of one clobbering the
 *      other's upload_batches row via onConflict.
 *   3. Derive products_tap catalog entries from the parsed TAP rows (0 LLM).
 *   4. Aggregate in-memory (aggregate.ts) → delete-then-insert into the 3 aggregate
 *      tables, scoped PER (creator × week) — NOT per upload_batch (design decision:
 *      replace only touches the creators actually present in this file for this
 *      period; other creators' data for the same week, uploaded in a different
 *      batch, is untouched). Re-uploading the exact same file reproduces the same
 *      batch_id/hash and the same creator×week delete scope, so it stays idempotent
 *      (replace, not duplicate). See writeAggregates doc for the exact delete filters.
 *   5. Auto-fill creators master from this batch's period summary + niche history.
 *   6. upload_batches → status='processed'. On any failure: status='failed' + error,
 *      and aggregate tables are NOT written partially (aggregates are only written
 *      after the full in-memory computation succeeds, in one pass, per creator).
 *   7. PX-M1 capability recompute (recomputeCapabilityForBatch) — refreshes
 *      bridge.px_creator_capability.proven_* for the creators in THIS batch. Own
 *      try/catch, own result fields (capability/capabilitySkipped/capabilityError):
 *      the performance aggregates are already committed by step 6, so a recompute
 *      failure must be reported, never roll back the ingest (surat tugas PX-M1 §5
 *      Langkah 3 — same reasoning as step 9's leak analysis, just earlier in the
 *      list since it has no file-upload precondition to wait on).
 *   8. audit_logs for ingest (type auto).
 *   9. Link-leakage analysis (runLeakAnalysis) when a TAP file is present — its own
 *      try/catch: the aggregates are already committed, so a leak failure is reported
 *      in the result (leakError) instead of failing/rolling back the batch.
 *   10. PX-M3-A coverage push (pushCoverageForBatch) — POSTs the full current
 *       bridge.px_creator_capability coverage snapshot to CDPS
 *       (docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md), so a weekly ingest run is
 *       also the (only) trigger for this push — zero new scheduler, same
 *       decision PX-M1's own recompute already made in step 7. Runs AFTER step
 *       7 (needs this batch's fresh proven_* already written) but does not
 *       depend on step 9's leak analysis. Own try/catch, own result fields
 *       (coveragePush/coveragePushSkipped/coveragePushError): never fails or
 *       rolls back an ingest that already committed everything else.
 */
export async function runIngest(input: RunIngestInput): Promise<RunIngestResult> {
  const admin = createAdminClient();
  const { mcnFile, tapFile, masterShopFile, actorId } = input;

  // ---- 1. Parse ----
  const mcnParsed = await parseMcnFile(mcnFile);
  const tapParsed = tapFile
    ? await parseTapFile(tapFile)
    : { rows: [] as TapRow[], skipped: [] as SkippedRow[], rawHeadersFound: [] as string[] };
  const skipped: SkippedRow[] = [...mcnParsed.skipped, ...tapParsed.skipped];

  const period = derivePeriod(mcnParsed.rows);
  if (!period) {
    if (mcnParsed.rows.length === 0) {
      throw new Error(describeMcnParseFailure(mcnParsed));
    }
    throw new Error("Kolom Tanggal tidak terbaca di file MCN — pastikan file export platform asli.");
  }
  const { periodStart, periodEnd } = period;
  // batch_id is scoped to file CONTENT, not just the week: `ingest:${periodStart}:${hash8}`
  // (hash8 = first 8 hex chars of the MCN file's sha256, computed once below and reused
  // for both the batch_id and the file_hash column). Two CMs uploading different creator
  // sets for the SAME week now get two batch_ids side-by-side instead of clobbering each
  // other's upload_batches row; re-uploading the exact same file reproduces the same
  // batch_id, so the upsert (onConflict batch_id) + per-creator delete-then-insert in
  // writeAggregates below stays idempotent (CLAUDE.md replace semantics, scoped per
  // creator × week — see writeAggregates doc).
  const hash = await fileHash(mcnFile);
  const hash8 = hash.slice(0, 8);
  const batchId = `ingest:${periodStart}:${hash8}`;

  // ---- Skema W1-W5 (final, CLAUDE.md/BUILD_PLAN) — tolak sebelum staging apapun ----
  const schemeCheck = validateW1W5Period(periodStart, periodEnd);
  if (!schemeCheck.valid) {
    throw new Error(schemeCheck.reason ?? "Periode upload tidak sesuai skema W1-W5.");
  }

  // ---- Cek overlap dengan batch processed lain yang periodenya beda ----
  // Periode identik (period_start sama persis) = replace path yang sudah ada di
  // bawah — dilanjutkan tanpa ditolak di sini. Sejak batch_id disertai hash8 file,
  // satu period_start bisa punya BANYAK baris upload_batches processed (satu per
  // kreator-set/file berbeda minggu itu) — replace kini di-scope PER KREATOR PER
  // MINGGU (lihat writeAggregates), jadi batch-batch berdampingan dgn period_start
  // sama ini valid dan `.neq("period_start", periodStart)` di bawah tetap benar
  // mengecualikan SEMUA baris periode ini (bukan cuma satu), tak peduli jumlahnya.
  // Periode BEDA tapi range tanggalnya overlap dengan batch processed existing →
  // tolak (mis. batch lama pra-skema W1-W5 yang punya periode bebas).
  const { data: existingBatches, error: existingBatchesError } = await admin
    .from("upload_batches")
    .select("batch_id, period_start, period_end")
    .eq("status", "processed")
    .neq("period_start", periodStart)
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart);
  if (existingBatchesError) {
    throw new Error(`Gagal memeriksa overlap batch: ${existingBatchesError.message}`);
  }
  const conflicting = (existingBatches ?? []).find(
    (b) => b.period_start && b.period_end && b.period_start <= periodEnd && b.period_end >= periodStart
  );
  if (conflicting) {
    throw new Error(
      `Periode upload (${periodStart} s/d ${periodEnd}) bentrok dengan batch "${conflicting.batch_id}" ` +
        `yang sudah diproses untuk periode ${conflicting.period_start} s/d ${conflicting.period_end}. ` +
        `Upload periode yang sama persis untuk replace, atau pilih periode W1-W5 yang tidak overlap.`
    );
  }

  // Resolve creator names -> creators.id. A creator appearing in a platform
  // performance report is by definition already joined with MEA (CLAUDE.md #1),
  // so newStatus="aktif" (same convention as /metrics upload).
  const detectedNames = distinctCreatorNames(mcnParsed.rows.map((r) => ({ creator: r.creatorName })));
  const { byName, createdProspects, failed: failedCreators } = await resolveCreatorNames(
    admin, detectedNames, actorId, "aktif"
  );
  // A creator that could not be created/resolved no longer aborts the upload —
  // it is reported here and only ITS rows are skipped below.
  for (const f of failedCreators) {
    skipped.push({ row: -1, reason: `creator "${f.name}" gagal dibuat: ${f.reason}` });
  }

  const resolvedMcnRows: McnRow[] = [];
  for (const r of mcnParsed.rows) {
    const creatorId = r.creatorName ? byName.get(r.creatorName.toLowerCase()) ?? null : null;
    if (!creatorId) {
      skipped.push({ row: -1, reason: `creator "${r.creatorName || "(kosong)"}" tidak dapat di-resolve` });
      continue;
    }
    resolvedMcnRows.push({ ...r, creatorName: creatorId });
  }

  // ---- 2. upload_batches: staging ----
  // (hash already computed above — reused here for file_hash, not recomputed.)
  const creatorIdsSet = new Set(resolvedMcnRows.map((r) => r.creatorName));
  // TAP (agency-link) 1-creator export variant carries NO creator column at all
  // (CLAUDE.md #5). We no longer write TAP rows to staging, but the derived-catalog
  // step below can't attribute a nameless TAP row to a creator when the paired MCN
  // is multi-creator — record that gap in `skipped` so the information isn't lost.
  const tapRowsMissingCreator = tapParsed.rows.filter((r) => !r.creatorName.trim()).length;
  if (tapRowsMissingCreator > 0 && creatorIdsSet.size !== 1) {
    skipped.push({
      row: -1,
      reason:
        `${tapRowsMissingCreator} baris TAP tanpa nama kreator tidak dapat diatribusikan ` +
        `ke creator manapun (file MCN pasangannya punya ${creatorIdsSet.size} kreator berbeda, bukan 1).`,
    });
  }
  const { error: batchInsertError } = await admin.from("upload_batches").upsert(
    {
      batch_id: batchId,
      source_type: "mcn",
      uploaded_by: actorId,
      uploaded_at: new Date().toISOString(),
      row_count_raw: mcnParsed.rows.length + tapParsed.rows.length,
      creators_count: creatorIdsSet.size,
      period_start: periodStart,
      period_end: periodEnd,
      file_hash: hash,
      status: "staging",
      processed_at: null,
      error: null,
    },
    { onConflict: "batch_id" }
  );
  if (batchInsertError) throw new Error(`Gagal mencatat upload_batches: ${batchInsertError.message}`);

  try {
    const week = periodStart; // catalog/audit week key = period_start (task spec §5)

    // ---- 3. Derive products_tap entries from TAP weekly rows (deterministic, 0 LLM) ----
    // Master-upload rows in products_tap are never clobbered (see upsertDerivedFromTap doc);
    // this only enriches/creates 'derived_tap' catalog entries from the already-parsed TAP file.
    if (tapParsed.rows.length > 0) {
      const tapProductRows = tapParsed.rows
        .filter((r) => r.productId && r.shopId)
        .map((r) => ({
          product_id: r.productId,
          product_name: r.productInfo,
          shop_id: r.shopId,
          shop_name: r.shopName,
          level2_category: r.level2Category,
          affiliate_gmv: r.affiliateGmv,
          items_sold: r.itemsSold,
        }));
      const tapUpsertResult = await upsertDerivedFromTap(admin, tapProductRows, week);
      for (const reason of tapUpsertResult.errors) {
        skipped.push({ row: -1, reason: `products_tap: ${reason}` });
      }
    }

    // ---- 4. Aggregate in-memory (1-pass) ----
    const bounds = await getConfig<PriceBounds>("segments.price_bounds");
    const topN = await getConfig<number>("ingest.top_n_products");
    const periodSummary = buildPeriodSummary(resolvedMcnRows);
    const subcatSegment = buildSubcatSegment(resolvedMcnRows, bounds);
    const topProducts = buildTopProducts(resolvedMcnRows, topN);

    await writeAggregates(
      admin, batchId, [...creatorIdsSet], periodStart, periodEnd, periodSummary, subcatSegment, topProducts
    );

    // ---- 5. Auto-fill creators master ----
    // Follower count per creator from the MCN file ("Creator follower count",
    // 2026-07 export — legacy exports lack the column → map stays empty and the
    // followers field is left untouched). Same value repeats on every row of a
    // creator; max() is a cheap tie-break in case rows disagree within one file.
    const followersByCreator = new Map<string, number>();
    for (const r of resolvedMcnRows) {
      if (r.followerCount === null) continue;
      const prev = followersByCreator.get(r.creatorName);
      if (prev === undefined || r.followerCount > prev) {
        followersByCreator.set(r.creatorName, r.followerCount);
      }
    }
    await autoFillCreators(admin, actorId, periodSummary, subcatSegment, followersByCreator);

    // ---- 6. upload_batches: processed ----
    const { error: doneError } = await admin
      .from("upload_batches")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("batch_id", batchId);
    if (doneError) throw new Error(`Gagal update status upload_batches: ${doneError.message}`);

    // ---- 7. PX-M1: recompute bridge.px_creator_capability.proven_* (own try/catch,
    // never fails the ingest — see step doc above and capability-recompute.ts) ----
    const capabilityResult = await recomputeCapabilityForBatch(admin, [...creatorIdsSet], actorId);

    // ---- 8. Audit ----
    // rows_tap = number of TAP rows actually parsed (no staging round-trip anymore).
    // leak_engine flag records the product decision in force at ingest time; the leak
    // analysis itself writes its own audit row (m4.leak_compute) in step 8.
    const rowsTap = tapParsed.rows.length;
    await writeAudit({
      actorId,
      action: "ingest.run",
      entityType: "upload_batches",
      entityId: batchId,
      after: {
        period_start: periodStart, period_end: periodEnd,
        rows_mcn: resolvedMcnRows.length, rows_tap: rowsTap,
        creators: creatorIdsSet.size,
        aggregate_rows: {
          period_summary: periodSummary.length,
          subcat_segment: subcatSegment.length,
          top_products: topProducts.length,
        },
        dropped_raw: true,
        leak_engine: "in_platform_compute",
      },
      type: "auto",
    });

    for (const name of createdProspects) {
      skipped.push({
        row: -1,
        reason:
          `creator "${name}" belum ada di master → dibuat otomatis (status aktif, CM masih kosong — ` +
          `isi lewat kartu "Kreator belum punya CM")`,
      });
    }

    // ---- 9. Analisa link leakage dari BARIS YANG SAMA (0 LLM) ----
    // Keputusan interview: fungsi artifak "Agency Leaked Generator" dipindah ke
    // dalam platform, dan file MCN+TAP mingguan cukup diupload SEKALI di sini.
    // Dijalankan setelah batch 'processed' dan dibungkus try/catch sendiri:
    // agregat performa sudah aman tersimpan, jadi kegagalan analisa bocor tidak
    // boleh menggagalkan (atau me-rollback) ingest — cukup dilaporkan ke UI.
    let leak: LeakAnalysisResult | null = null;
    let leakSkipped: string | null = null;
    let leakError: string | null = null;
    if (tapParsed.rows.length === 0) {
      leakSkipped =
        "Analisa kebocoran dilewati: file TAP (via agency link) tidak diunggah. Tanpa TAP, " +
        "seluruh GMV di shop ber-deal akan terlihat 100% bocor — angka bocor tidak dihitung.";
    } else {
      try {
        leak = await runLeakAnalysis({
          mcnRows: mcnParsed.rows,
          tapRows: tapParsed.rows,
          masterFile: masterShopFile ?? null,
          periodStart,
          periodEnd,
          actorId,
          origin: "ingest",
        });
      } catch (e) {
        leakError = e instanceof Error ? e.message : String(e);
      }
    }

    // ---- 10. PX-M3-A: push the full coverage snapshot to CDPS (own try/catch,
    // never fails the ingest — see step doc above and coverage-push.ts) ----
    const coveragePushResult = await pushCoverageForBatch(admin, actorId);

    return {
      batchId,
      periodStart,
      periodEnd,
      rowsProcessedMcn: resolvedMcnRows.length,
      rowsProcessedTap: rowsTap,
      creatorsCount: creatorIdsSet.size,
      createdProspects,
      skipped,
      aggregateRows: {
        periodSummary: periodSummary.length,
        subcatSegment: subcatSegment.length,
        topProducts: topProducts.length,
      },
      droppedRaw: true,
      leak,
      leakSkipped,
      leakError,
      capability: capabilityResult.rows,
      capabilitySkipped: capabilityResult.skipped,
      capabilityError: capabilityResult.error,
      coveragePush: coveragePushResult.result,
      coveragePushSkipped: coveragePushResult.skipped,
      coveragePushError: coveragePushResult.error,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("upload_batches").update({ status: "failed", error: message }).eq("batch_id", batchId);
    throw e;
  }
}

/** Bulk-delete chunk size for `.in(creator_id, [...])` filters (consistent with upsertDerivedFromTap in src/lib/m10/products.ts). */
const DELETE_CHUNK = 200;

/**
 * Idempotent PER (creator × week), not per upload_batch (design decision, see
 * runIngest doc): delete-then-insert on all three aggregate tables, scoped to
 * ONLY the creators present in this file and this period — never a table-wide
 * or whole-batch wipe. This is what makes two CMs uploading different creator
 * sets for the SAME week non-destructive to each other: each upload only
 * touches the rows of the creators actually present in its own file, and (as a
 * side effect) also cleans up any stale rows left over from the old
 * global-batch_id era for those same creators/period.
 *
 * - creator_period_summary / creator_top_products: delete where creator_id IN
 *   (creators in this file) AND period_start = periodStart.
 * - creator_subcat_segment_gmv: this table has no period_start column — it
 *   only carries window_end (= periodEnd, per buildSubcatSegment in
 *   aggregate.ts), so the delete is scoped by window_end instead.
 *
 * Deletes are chunked by DELETE_CHUNK creator ids per `.in()` call (bulk style
 * consistent with upsertDerivedFromTap in src/lib/m10/products.ts) so a large
 * creator set doesn't hit a query size limit.
 *
 * Exported for unit tests (idempotency contract).
 */
export async function writeAggregates(
  admin: SupabaseClient,
  batchId: string,
  creatorIds: string[],
  periodStart: string,
  periodEnd: string,
  periodSummary: ReturnType<typeof buildPeriodSummary>,
  subcatSegment: ReturnType<typeof buildSubcatSegment>,
  topProducts: ReturnType<typeof buildTopProducts>
): Promise<void> {
  // Idempotent per (creator × week): delete-then-insert, scoped to this file's
  // creators + period — NOT the whole upload_batch (design decision above).
  for (let i = 0; i < creatorIds.length; i += DELETE_CHUNK) {
    const chunk = creatorIds.slice(i, i + DELETE_CHUNK);
    if (chunk.length === 0) continue;
    await admin.from("creator_period_summary").delete()
      .in("creator_id", chunk).eq("period_start", periodStart);
    await admin.from("creator_top_products").delete()
      .in("creator_id", chunk).eq("period_start", periodStart);
    await admin.from("creator_subcat_segment_gmv").delete()
      .in("creator_id", chunk).eq("window_end", periodEnd);
  }

  const summaryRows = periodSummary.map((s) => ({
    creator_id: s.creatorId,
    period_start: s.periodStart,
    period_end: s.periodEnd,
    upload_batch: batchId,
    gmv_total: s.gmvTotal,
    nmv: null,
    affiliate_gmv: s.affiliateGmv,
    affiliate_live_gmv: s.affiliateLiveGmv,
    affiliate_video_gmv: s.affiliateVideoGmv,
    live_orders: s.liveOrders,
    video_orders: s.videoOrders,
    orders: s.orders,
    items_sold: s.itemsSold,
    direct_gmv: s.directGmv,
    refund_gmv: s.refundGmv,
    ctr: s.ctr,
    ctor: s.ctor,
    live_pct: s.livePct,
  }));
  for (let i = 0; i < summaryRows.length; i += 500) {
    const { error } = await admin.from("creator_period_summary").insert(summaryRows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis creator_period_summary: ${error.message}`);
  }

  const subcatRows = subcatSegment.map((s) => ({
    creator_id: s.creatorId,
    level2_category: s.level2Category,
    price_segment: s.priceSegment,
    upload_batch: batchId,
    window_end: s.windowEnd,
    gmv: s.gmv,
    live_gmv: s.liveGmv,
    items_sold: s.itemsSold,
    orders: s.orders,
    avg_price: s.avgPrice,
  }));
  for (let i = 0; i < subcatRows.length; i += 500) {
    const { error } = await admin.from("creator_subcat_segment_gmv").insert(subcatRows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis creator_subcat_segment_gmv: ${error.message}`);
  }

  const topRows = topProducts.map((p) => ({
    creator_id: p.creatorId,
    period_start: p.periodStart,
    period_end: p.periodEnd,
    upload_batch: batchId,
    rank: p.rank,
    product_id: p.productId,
    product_info: p.productInfo,
    shop_id: p.shopId,
    level2_category: p.level2Category,
    gmv: p.gmv,
    orders: p.orders,
  }));
  for (let i = 0; i < topRows.length; i += 500) {
    const { error } = await admin.from("creator_top_products").insert(topRows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis creator_top_products: ${error.message}`);
  }
}

/** 431936 → "431.936" (dot-thousands, matches the free-text creators.followers convention). */
function formatFollowerCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Auto-fill master creators from this batch (CLAUDE.md #1/#2, same convention as
 * /metrics uploadPlatformMetrics): status→aktif, platform←tiktok (MCN/TAP source
 * is always TikTok custom report per Module 0.5), jenis_creator from THIS BATCH's
 * merged live/video GMV (unchanged behavior — task A.2 decision: jenis_creator
 * stays batch-derived, not averaged), niche/top_niches from this batch's subcat
 * GMV combined with prior creator_subcat_segment_gmv history, followers from the
 * MCN file's "Creator follower count" column (2026-07 export; absent on legacy
 * exports → untouched).
 *
 * gmv/gmv_live/gmv_video (task A.1, CLAUDE.md #4 — one averaging implementation,
 * reused from src/lib/m8/weekly-growth.ts): no longer this batch's total — each
 * is the AVERAGE OF MONTHLY TOTALS across every month the creator has data in
 * creator_period_summary, queried fresh by creator_id (NOT scoped to this
 * batch/upload). This function MUST run after writeAggregates has already
 * delete-then-inserted this batch's rows (see runIngest step order: writeAggregates
 * at step 4, autoFillCreators at step 5) so the just-ingested weeks are included
 * in the average, not stale pre-upload data.
 *
 * One UPDATE + one audit row per creator, only changed fields; manual CM fields
 * untouched. The shared parts (status/platform/gmv-avg/jenis_creator update +
 * audit) are factored into src/lib/ingest/creator-autofill.ts and reused by the
 * Shopee pipeline (src/lib/ingest/shopee-run.ts) — CLAUDE.md #4, one
 * implementation. Niche/top_niches is computed here from this pipeline's own
 * subcatSegment via rankTopNiches(); the Shopee pipeline ranks its own the
 * same way from its category data (shopee-category.ts/shopee-aggregate.ts).
 */
async function autoFillCreators(
  admin: SupabaseClient,
  actorId: string,
  periodSummary: ReturnType<typeof buildPeriodSummary>,
  subcatSegment: ReturnType<typeof buildSubcatSegment>,
  followersByCreator: Map<string, number>
): Promise<void> {
  if (periodSummary.length === 0) return;
  const creatorIds = periodSummary.map((s) => s.creatorId);

  const { data: existingCreators, error: existingError } = await admin
    .from("creators")
    .select("id, status, platform, jenis_creator, niche, top_niches, followers")
    .in("id", creatorIds);
  if (existingError) throw new Error(`Gagal membaca master creator: ${existingError.message}`);
  const existingById = new Map((existingCreators ?? []).map((c) => [c.id, c]));

  // Niche ranking: this batch's subcat GMV + prior history from creator_subcat_segment_gmv
  // (excluding rows from batches we are about to overwrite — none yet, this runs before
  // the delete-then-insert in writeAggregates when called from runIngest's flow order,
  // but is safe either way since it reads by creator_id, not upload_batch).
  const { data: historyRows, error: historyError } = await admin
    .from("creator_subcat_segment_gmv")
    .select("creator_id, level2_category, gmv")
    .in("creator_id", creatorIds);
  if (historyError) throw new Error(`Gagal membaca histori niche: ${historyError.message}`);

  const nicheInput = [
    ...subcatSegment.map((s) => ({ creator_id: s.creatorId, sub_category: s.level2Category, value: s.gmv })),
    ...(historyRows ?? []).map((r) => ({
      creator_id: r.creator_id as string,
      sub_category: r.level2_category as string,
      value: Number(r.gmv ?? 0),
    })),
  ];
  const topNichesByCreator = rankTopNiches(nicheInput);

  // Monthly-average GMV (task A.1, shared helper — CLAUDE.md #4): read the FULL
  // creator_period_summary history per creator_id (all batches/periods, not
  // just this one) — called after writeAggregates so this batch's just-inserted
  // rows are already visible.
  const avgGmvByCreator = await fetchMonthlyAvgGmvByCreator(admin, creatorIds);

  for (const s of periodSummary) {
    const existing = existingById.get(s.creatorId);
    const jenisCreator = deriveJenisCreator(s.affiliateLiveGmv, s.affiliateVideoGmv);
    const topNiches = topNichesByCreator.get(s.creatorId);
    const avgGmv = avgGmvByCreator.get(s.creatorId)!;
    const platformValue = platformFromReportSource("mcn_tiktok_product");

    const { updates, before, after } = computeSharedAutoFillFields(existing, platformValue, jenisCreator, avgGmv);

    // followers ← "Creator follower count" from the MCN file (2026-07 export).
    // creators.followers is free-text (legacy acquisition ranges like
    // "20.100 - 50.000"); the platform count is exact, stored dot-thousands
    // ("431.936") to match the existing display convention. Absent column
    // (legacy export) → no entry in the map → field untouched.
    const followerCount = followersByCreator.get(s.creatorId);
    if (followerCount !== undefined) {
      const followersText = formatFollowerCount(followerCount);
      if (followersText !== (existing?.followers ?? null)) {
        updates.followers = followersText;
        before.followers = existing?.followers ?? null;
        after.followers = followersText;
      }
    }

    const nichesChanged =
      topNiches && topNiches.length > 0 &&
      (topNiches[0] !== existing?.niche ||
        JSON.stringify(topNiches) !== JSON.stringify(existing?.top_niches ?? null));
    if (nichesChanged) {
      updates.niche = topNiches![0];
      updates.top_niches = topNiches;
      before.niche = existing?.niche ?? null;
      before.top_niches = existing?.top_niches ?? null;
      after.niche = topNiches![0];
      after.top_niches = topNiches;
    }

    await writeCreatorAutoFillUpdate(admin, actorId, s.creatorId, updates, before, after);
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { deriveJenisCreator, resolveCreatorNamesByPlatform } from "@/lib/platform-csv";
import { recordPendingCreators, pendingSkipReason } from "@/lib/creators/pending";
import { validateW1W5Period } from "@/lib/utils/date";
import { parseShopeeFile, validateSingleShopeeWindow, type ShopeeRow, type SkippedShopeeRow } from "./shopee-csv";
import { buildShopeePeriodSummary, type ShopeePeriodSummaryRow } from "./shopee-aggregate";
import { computeSharedAutoFillFields, fetchMonthlyAvgGmvByCreator, writeCreatorAutoFillUpdate } from "./creator-autofill";

export interface RunShopeeIngestInput {
  file: File;
  actorId: string;
}

export interface RunShopeeIngestResult {
  batchId: string;
  periodStart: string;
  periodEnd: string;
  rowsTotal: number;
  rowsCompleted: number;
  rowsUsed: number; // completed rows that survived product/shop/date/username checks
  creatorsCount: number;
  /** Username belum terdaftar → daftar tunggu, barisnya dilewati (migration 0028). */
  pendingCreators: string[];
  skipped: SkippedShopeeRow[];
  gmvTotal: number;
  /** Always true: this pipeline is aggregates-only — raw rows are never written to the DB. */
  droppedRaw: boolean;
}

/** sha256 of the raw file bytes — same provenance convention as the TikTok pipeline (run.ts). */
async function fileHash(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Shopee Lane 1 orchestrator (CLAUDE.md task spec) — aggregates-only, drop-raw,
 * mirroring src/lib/ingest/run.ts's TikTok pipeline shape:
 *   1. Parse the single combined Conversion Report CSV; keep only Status
 *      Pesanan = "Selesai" rows (task rule #1).
 *   2. Derive the window from Waktu Pesanan Selesai across all Selesai rows —
 *      reject if they touch more than one W1-W5 window or cross a month
 *      boundary (task rule #2). periodStart/periodEnd = the window's canonical
 *      boundary dates (not the min/max actual dates found).
 *   3. Resolve Username Affiliate -> creators.id SCOPED TO platform='shopee'
 *      only (task rule #3, CLAUDE.md #5 — never match a TikTok creator with
 *      the same username). Username yang belum terdaftar TIDAK dibuat otomatis
 *      lagi (migration 0028): masuk daftar tunggu, barisnya dilewati.
 *   4. Aggregate in-memory (shopee-aggregate.ts) -> delete-then-insert into
 *      creator_period_summary ONLY (task rule #4 — no subcat/top-products for
 *      Shopee yet), scoped PER (creator × week), same replace semantics as the
 *      TikTok pipeline.
 *   5. Auto-fill creators master (gmv/gmv_live/gmv_video monthly average,
 *      status, platform, jenis_creator) via the shared helper in
 *      creator-autofill.ts — niche is NOT touched (task rule #4, no subcat
 *      data for Shopee).
 *   6. upload_batches -> processed; audit_logs.
 *
 * Campaign Type / Partner Promo columns are intentionally ignored — leak/BD
 * analysis for Shopee is deferred to the external Agency Leaked Generator
 * artifact once the Shopee master-deal data is synced (task rule #5, product
 * decision, NOT an oversight).
 */
export async function runShopeeIngest(input: RunShopeeIngestInput): Promise<RunShopeeIngestResult> {
  const admin = createAdminClient();
  const { file, actorId } = input;

  // ---- 1. Parse + filter to Selesai only ----
  const parsed = await parseShopeeFile(file);
  const skipped: SkippedShopeeRow[] = [...parsed.skipped];

  if (parsed.rows.length === 0) {
    const hasContent = parsed.rawHeadersFound.length > 0 || parsed.rowsNonCompleted > 0;
    if (!hasContent) {
      throw new Error(
        "File Shopee kosong atau tidak terbaca — pastikan file Conversion Report Shopee asli (bukan file kosong/rusak)."
      );
    }
    throw new Error(
      `File Shopee tidak menghasilkan baris "Selesai" (${parsed.rowsNonCompleted} baris berstatus lain, ` +
        `${parsed.skipped.length} baris dilewati). Hanya pesanan berstatus Selesai yang dihitung.`
    );
  }

  // ---- 2. Derive + validate single W1-W5 window (task rule #2) ----
  const windowCheck = validateSingleShopeeWindow(parsed.rows);
  if (!windowCheck.valid) {
    throw new Error(windowCheck.reason ?? "Periode upload Shopee tidak sesuai skema W1-W5.");
  }
  const { periodStart, periodEnd } = windowCheck as { periodStart: string; periodEnd: string };

  // Defensive re-check against the shared W1-W5 validator (belt-and-suspenders;
  // validateSingleShopeeWindow already only returns canonical window boundaries,
  // so this should always pass, but keeps both pipelines provably consistent).
  const schemeCheck = validateW1W5Period(periodStart, periodEnd);
  if (!schemeCheck.valid) {
    throw new Error(schemeCheck.reason ?? "Periode upload Shopee tidak sesuai skema W1-W5.");
  }

  const hash = await fileHash(file);
  const hash8 = hash.slice(0, 8);
  const batchId = `ingest-shopee:${periodStart}:${hash8}`;

  // ---- Cek overlap dengan batch processed lain yang periodenya beda (sama seperti TikTok) ----
  const { data: existingBatches, error: existingBatchesError } = await admin
    .from("upload_batches")
    .select("batch_id, period_start, period_end")
    .eq("status", "processed")
    .eq("source_type", "shopee")
    .neq("period_start", periodStart)
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart);
  if (existingBatchesError) {
    throw new Error(`Gagal memeriksa overlap batch Shopee: ${existingBatchesError.message}`);
  }
  const conflicting = (existingBatches ?? []).find(
    (b) => b.period_start && b.period_end && b.period_start <= periodEnd && b.period_end >= periodStart
  );
  if (conflicting) {
    throw new Error(
      `Periode upload Shopee (${periodStart} s/d ${periodEnd}) bentrok dengan batch "${conflicting.batch_id}" ` +
        `yang sudah diproses untuk periode ${conflicting.period_start} s/d ${conflicting.period_end}. ` +
        `Upload periode yang sama persis untuk replace, atau pilih periode W1-W5 yang tidak overlap.`
    );
  }

  // ---- 3. Resolve Username Affiliate -> creators.id, platform='shopee' ONLY ----
  // Case-insensitive de-dup (Username Affiliate can repeat with different casing
  // across rows) — same intent as distinctCreatorNames in platform-csv.ts, but
  // that helper keys off a different column set (COL.creator), so a small local
  // dedupe is used here instead of forcing this parser's shape onto it.
  const seenUsernames = new Set<string>();
  const distinctUsernames: string[] = [];
  for (const r of parsed.rows) {
    const key = r.affiliateUsername.toLowerCase();
    if (!key || seenUsernames.has(key)) continue;
    seenUsernames.add(key);
    distinctUsernames.push(r.affiliateUsername);
  }
  // TIDAK membuat kreator baru (migration 0028) — username asing masuk daftar tunggu.
  const { byName, unresolved } = await resolveCreatorNamesByPlatform(
    admin, distinctUsernames, "shopee"
  );

  const resolvedRows: ShopeeRow[] = [];
  const skippedRowsByName = new Map<string, number>();
  for (const r of parsed.rows) {
    const creatorId = byName.get(r.affiliateUsername.toLowerCase());
    if (!creatorId) {
      const key = r.affiliateUsername.trim().toLowerCase();
      skippedRowsByName.set(key, (skippedRowsByName.get(key) ?? 0) + 1);
      continue;
    }
    resolvedRows.push({ ...r, affiliateUsername: creatorId });
  }

  const pendingCreators = [...unresolved];
  if (pendingCreators.length > 0) {
    await recordPendingCreators(admin, {
      usernames: pendingCreators,
      source: "shopee_weekly",
      platform: "shopee",
      batchId,
      actorId,
      rowsByUsername: skippedRowsByName,
    });
    for (const name of pendingCreators) {
      const rows = skippedRowsByName.get(name.toLowerCase()) ?? 0;
      skipped.push({
        row: -1,
        reason: `${pendingSkipReason(name, "shopee_weekly")} (${rows} baris dilewati)`,
      });
    }
  }
  const namelessRows = skippedRowsByName.get("") ?? 0;
  if (namelessRows > 0) {
    skipped.push({ row: -1, reason: `${namelessRows} baris tanpa username affiliate tidak dapat di-resolve` });
  }

  const creatorIdsSet = new Set(resolvedRows.map((r) => r.affiliateUsername));

  // ---- upload_batches: staging ----
  const { error: batchInsertError } = await admin.from("upload_batches").upsert(
    {
      batch_id: batchId,
      source_type: "shopee",
      uploaded_by: actorId,
      uploaded_at: new Date().toISOString(),
      row_count_raw: parsed.rows.length + parsed.rowsNonCompleted,
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
  if (batchInsertError) throw new Error(`Gagal mencatat upload_batches Shopee: ${batchInsertError.message}`);

  try {
    // ---- 4. Aggregate in-memory + write (creator_period_summary ONLY) ----
    const periodSummary = buildShopeePeriodSummary(resolvedRows, periodStart, periodEnd);
    await writeShopeeAggregates(admin, batchId, [...creatorIdsSet], periodStart, periodSummary);

    // ---- 5. Auto-fill creators master (shared helper, no niche for Shopee) ----
    await autoFillShopeeCreators(admin, actorId, periodSummary);

    // ---- 6. upload_batches: processed ----
    const { error: doneError } = await admin
      .from("upload_batches")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("batch_id", batchId);
    if (doneError) throw new Error(`Gagal update status upload_batches Shopee: ${doneError.message}`);

    const gmvTotal = periodSummary.reduce((acc, s) => acc + s.gmvTotal, 0);

    // ---- 7. Audit ----
    await writeAudit({
      actorId,
      action: "ingest.run_shopee",
      entityType: "upload_batches",
      entityId: batchId,
      after: {
        period_start: periodStart, period_end: periodEnd,
        rows_total: parsed.rows.length + parsed.rowsNonCompleted,
        rows_completed: parsed.rows.length,
        rows_used: resolvedRows.length,
        creators: creatorIdsSet.size,
        pending_creators: pendingCreators.length,
        gmv_total: gmvTotal,
        dropped_raw: true,
        leak_engine: "external_artifact",
      },
      type: "auto",
    });

    return {
      batchId,
      periodStart,
      periodEnd,
      rowsTotal: parsed.rows.length + parsed.rowsNonCompleted,
      rowsCompleted: parsed.rows.length,
      rowsUsed: resolvedRows.length,
      creatorsCount: creatorIdsSet.size,
      pendingCreators,
      skipped,
      gmvTotal,
      droppedRaw: true,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("upload_batches").update({ status: "failed", error: message }).eq("batch_id", batchId);
    throw e;
  }
}

/** Bulk-delete chunk size for `.in(creator_id, [...])` filters (consistent with run.ts). */
const DELETE_CHUNK = 200;

/**
 * Idempotent PER (creator × week), same design as writeAggregates in run.ts:
 * delete-then-insert into creator_period_summary ONLY, scoped to the creators
 * present in this file and this period. Two CMs (or a CM re-uploading the same
 * window) never clobber each other's creators. nmv/direct_gmv/refund_gmv/ctr/
 * ctor/live_pct/live_orders/video_orders/items_sold have no Shopee source in
 * this report shape — left at their column defaults (0/null), which is a
 * neutral value (not fabricated data) since those columns are NOT NOT-NULL-
 * without-default in the schema (see supabase/migrations/0016_ingest_aggregates.sql).
 *
 * Exported for unit tests (idempotency contract, mirrors run.test.ts).
 */
export async function writeShopeeAggregates(
  admin: SupabaseClient,
  batchId: string,
  creatorIds: string[],
  periodStart: string,
  periodSummary: ShopeePeriodSummaryRow[]
): Promise<void> {
  for (let i = 0; i < creatorIds.length; i += DELETE_CHUNK) {
    const chunk = creatorIds.slice(i, i + DELETE_CHUNK);
    if (chunk.length === 0) continue;
    await admin.from("creator_period_summary").delete()
      .in("creator_id", chunk).eq("period_start", periodStart);
  }

  const rows = periodSummary.map((s) => ({
    creator_id: s.creatorId,
    period_start: s.periodStart,
    period_end: s.periodEnd,
    upload_batch: batchId,
    gmv_total: s.gmvTotal,
    nmv: null,
    // affiliate_gmv mirrors gmv_total (same convention as the TikTok pipeline's
    // buildPeriodSummary: "gmv_total = affiliate_gmv", see aggregate.ts doc).
    affiliate_gmv: s.gmvTotal,
    affiliate_live_gmv: s.affiliateLiveGmv,
    affiliate_video_gmv: s.affiliateVideoGmv,
    live_orders: 0,
    video_orders: 0,
    orders: s.orders,
    items_sold: 0,
    direct_gmv: 0,
    refund_gmv: 0,
    ctr: null,
    ctor: null,
    live_pct: s.gmvTotal > 0 ? s.affiliateLiveGmv / s.gmvTotal : null,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("creator_period_summary").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis creator_period_summary (Shopee): ${error.message}`);
  }
}

/**
 * Auto-fill master creators from this Shopee batch, reusing the shared helper
 * (creator-autofill.ts, CLAUDE.md #4) for status/platform/gmv-avg/jenis_creator.
 * niche/top_niches is NOT touched (task rule #4 — no subcat data for Shopee).
 */
async function autoFillShopeeCreators(
  admin: SupabaseClient,
  actorId: string,
  periodSummary: ShopeePeriodSummaryRow[]
): Promise<void> {
  if (periodSummary.length === 0) return;
  const creatorIds = periodSummary.map((s) => s.creatorId);

  const { data: existingCreators, error: existingError } = await admin
    .from("creators")
    .select("id, status, platform, jenis_creator")
    .in("id", creatorIds);
  if (existingError) throw new Error(`Gagal membaca master creator (Shopee): ${existingError.message}`);
  const existingById = new Map((existingCreators ?? []).map((c) => [c.id, c]));

  const avgGmvByCreator = await fetchMonthlyAvgGmvByCreator(admin, creatorIds);

  for (const s of periodSummary) {
    const existing = existingById.get(s.creatorId);
    const jenisCreator = deriveJenisCreator(s.affiliateLiveGmv, s.affiliateVideoGmv);
    const avgGmv = avgGmvByCreator.get(s.creatorId)!;

    const { updates, before, after } = computeSharedAutoFillFields(existing, "shopee", jenisCreator, avgGmv);
    await writeCreatorAutoFillUpdate(admin, actorId, s.creatorId, updates, before, after);
  }
}

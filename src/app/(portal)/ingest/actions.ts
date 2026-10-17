"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { runIngest, type RunIngestResult } from "@/lib/ingest/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingRelationError } from "@/lib/db/missing-migration";
import { MIGRATION_0094_MISSING } from "@/lib/ingest/shop-period-rollup";
import {
  assertValidObjectRef, downloadIngestFile, ingestObjectPaths, removeIngestFiles, type IngestObjectRef,
} from "@/lib/ingest/storage";

/**
 * Discriminated-union return (never throw across the server-action boundary): Next.js
 * censors a server action's thrown Error message in production ("An error occurred
 * in the Server Components render..."), so a pipeline rejection (periode bukan
 * W1-W5, kolom Tanggal tidak terbaca, ...) never reached the user. Every throw from
 * the pipeline is caught here and its message returned as `error` instead.
 */
export type RunIngestActionResult =
  | { ok: true; result: RunIngestResult }
  | { ok: false; error: string };

/**
 * Module 0.5 — single weekly upload entry point (MCN wajib + TAP opsional).
 * Thin wrapper: RBAC + FormData unpacking; the whole pipeline (parse → derive
 * products_tap catalog → agregat performa in-memory → upload_batches + audit,
 * raw never persisted) lives in src/lib/ingest/run.ts. Agency-leak analysis is
 * handled by a separate external artifact, not here. Deterministic, 0 token AI.
 */
export async function runIngestAction(formData: FormData): Promise<RunIngestActionResult> {
  try {
    const actor = await requirePermission("ingest.run");

    const mcnFile = formData.get("mcn_file");
    if (!(mcnFile instanceof File) || mcnFile.size === 0) {
      throw new Error("File MCN report (semua transaksi) wajib diunggah");
    }
    const extraRaw = formData.get("extra_mcn_file");
    const extraMcnFile = extraRaw instanceof File && extraRaw.size > 0 ? extraRaw : null;
    const tapRaw = formData.get("tap_file");
    const tapFile = tapRaw instanceof File && tapRaw.size > 0 ? tapRaw : null;
    const masterRaw = formData.get("master_file");
    const masterShopFile = masterRaw instanceof File && masterRaw.size > 0 ? masterRaw : null;

    const result = await runIngest({ mcnFile, extraMcnFile, tapFile, masterShopFile, actorId: actor.id });

    revalidatePath("/ingest");
    // Leak analysis runs in this pipeline again (in-platform compute) → refresh the
    // pages that read the rollup.
    revalidatePath("/link-leakage");
    revalidatePath("/workspace/cm");
    revalidatePath("/creators");
    revalidatePath("/dashboard");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Collects + validates the storage refs of one weekly upload; returns every object path for cleanup. */
interface StorageRefs {
  mcn: IngestObjectRef;
  extraMcn: IngestObjectRef | null;
  tap: IngestObjectRef | null;
  master: IngestObjectRef | null;
  paths: string[];
}

function validateStorageRefs(mcnRef: unknown, tapRef: unknown, masterRef: unknown, extraMcnRef: unknown): StorageRefs {
  assertValidObjectRef(mcnRef, "MCN");
  const paths = [...ingestObjectPaths(mcnRef)];
  // Optional second MCN export of the same week (e.g. MEA Academy), merged into one batch.
  let extraMcn: IngestObjectRef | null = null;
  if (extraMcnRef != null) {
    assertValidObjectRef(extraMcnRef, "MCN tambahan");
    extraMcn = extraMcnRef;
    paths.push(...ingestObjectPaths(extraMcn));
  }
  let tap: IngestObjectRef | null = null;
  if (tapRef != null) {
    assertValidObjectRef(tapRef, "TAP");
    tap = tapRef;
    paths.push(...ingestObjectPaths(tap));
  }
  // Optional "Master Data Shop" upload for the leak analysis (artifact's 3rd input).
  let master: IngestObjectRef | null = null;
  if (masterRef != null) {
    assertValidObjectRef(masterRef, "Master Data Shop");
    master = masterRef;
    paths.push(...ingestObjectPaths(master));
  }
  return { mcn: mcnRef, extraMcn, tap, master, paths };
}

export type StartIngestActionResult = { ok: true; jobId: string } | { ok: false; error: string };

/**
 * Storage-based weekly upload (large-file path). The browser has already pushed
 * the WHOLE MCN file (and optional TAP file) straight to Supabase Storage —
 * bypassing the ~4,5MB serverless body limit — so this action receives only the
 * object refs.
 *
 * A full week (MCN + Academy + TAP, ~1M rows) takes ~7 minutes; holding the
 * browser request open that long ended in "Failed to fetch" even though the batch
 * succeeded (W3 Okt 2026). So this action only records an ingest_jobs row
 * (migrasi 0094) and returns its id; the pipeline runs in after() within this
 * page's maxDuration, and the form polls getIngestJobAction. The pipeline itself
 * is unchanged: download server-side → runIngest over the file WHOLE → remove the
 * transient objects (best-effort, always, success or failure).
 */
export async function startIngestFromStorageAction(
  mcnRef: unknown,
  tapRef: unknown,
  masterRef?: unknown,
  extraMcnRef?: unknown
): Promise<StartIngestActionResult> {
  let paths: string[] = [];
  try {
    const actor = await requirePermission("ingest.run");
    const refs = validateStorageRefs(mcnRef, tapRef, masterRef, extraMcnRef);
    paths = refs.paths;

    const admin = createAdminClient();
    const { data: job, error: jobError } = await admin
      .from("ingest_jobs").insert({ platform: "tiktok", created_by: actor.id }).select("id").single();
    if (jobError || !job) {
      throw new Error(
        isMissingRelationError(jobError) ? MIGRATION_0094_MISSING : `Gagal membuat job upload: ${jobError?.message}`
      );
    }
    const jobId = (job as { id: string }).id;
    const jobPaths = paths;
    paths = []; // cleanup now belongs to the background run

    after(async () => {
      let update: Record<string, unknown>;
      try {
        const mcnFile = await downloadIngestFile(admin, refs.mcn);
        const extraMcnFile = refs.extraMcn ? await downloadIngestFile(admin, refs.extraMcn) : null;
        const tapFile = refs.tap ? await downloadIngestFile(admin, refs.tap) : null;
        const masterShopFile = refs.master ? await downloadIngestFile(admin, refs.master) : null;
        const result = await runIngest({ mcnFile, extraMcnFile, tapFile, masterShopFile, actorId: actor.id });
        update = { status: "done", result };
      } catch (e) {
        update = { status: "failed", error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
      } finally {
        await removeIngestFiles(admin, jobPaths);
      }
      const { error } = await admin.from("ingest_jobs")
        .update({ ...update, finished_at: new Date().toISOString() }).eq("id", jobId);
      if (error) console.error(`[ingest] gagal update ingest_jobs ${jobId}: ${error.message}`);
    });
    return { ok: true, jobId };
  } catch (e) {
    if (paths.length > 0) await removeIngestFiles(createAdminClient(), paths);
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * A running job older than this is reported as failed: the function was killed at
 * maxDuration (800s) before it could record the outcome.
 */
const INGEST_JOB_STALE_MS = 15 * 60 * 1000;

export type IngestJobStatus =
  | { status: "running"; startedAt: string }
  | { status: "done"; result: RunIngestResult }
  | { status: "failed"; error: string };

/** Poll target of the upload form. Only the uploader's own jobs are visible. */
export async function getIngestJobAction(jobId: string): Promise<IngestJobStatus> {
  try {
    const actor = await requirePermission("ingest.run");
    const { data, error } = await createAdminClient()
      .from("ingest_jobs").select("status, result, error, created_at")
      .eq("id", jobId).eq("created_by", actor.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { status: "failed", error: "Job upload tidak ditemukan." };
    const job = data as { status: string; result: RunIngestResult | null; error: string | null; created_at: string };
    if (job.status === "done" && job.result) {
      revalidatePath("/ingest");
      revalidatePath("/link-leakage");
      revalidatePath("/workspace/cm");
      revalidatePath("/workspace/bizdev");
      revalidatePath("/creators");
      revalidatePath("/dashboard");
      return { status: "done", result: job.result };
    }
    if (job.status === "failed") return { status: "failed", error: job.error ?? "Upload gagal." };
    if (Date.now() - new Date(job.created_at).getTime() > INGEST_JOB_STALE_MS) {
      return {
        status: "failed",
        error: "Proses melewati batas waktu server tanpa hasil. Cek Riwayat Upload; bila minggu ini belum Selesai, upload ulang.",
      };
    }
    return { status: "running", startedAt: job.created_at };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "Gagal membaca status upload." };
  }
}

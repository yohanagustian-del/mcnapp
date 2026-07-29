"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac";
import { runIngest, type RunIngestResult } from "@/lib/ingest/run";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertValidObjectRef, downloadIngestFile, removeIngestFiles, type IngestObjectRef,
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
    const tapRaw = formData.get("tap_file");
    const tapFile = tapRaw instanceof File && tapRaw.size > 0 ? tapRaw : null;
    const masterRaw = formData.get("master_file");
    const masterShopFile = masterRaw instanceof File && masterRaw.size > 0 ? masterRaw : null;

    const result = await runIngest({ mcnFile, tapFile, masterShopFile, actorId: actor.id });

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

/**
 * Storage-based weekly upload (large-file path). The browser has already pushed
 * the WHOLE MCN file (and optional TAP file) straight to Supabase Storage —
 * bypassing the ~4,5MB serverless body limit that blocked ~61k-row exports — so
 * this action receives only the object refs. It downloads the files server-side
 * (service-role, RLS-bypass), runs the SAME parse → aggregate → drop-raw
 * pipeline as runIngestAction over the file WHOLE (no splitting ⇒ no
 * replace-loss), then removes the transient objects (raw never persisted).
 *
 * Cleanup is best-effort and always runs (success or failure); a leftover
 * object in the private transient bucket is harmless and never masks the result.
 */
export async function runIngestFromStorageAction(
  mcnRef: unknown,
  tapRef: unknown,
  masterRef?: unknown
): Promise<RunIngestActionResult> {
  const paths: string[] = [];
  try {
    const actor = await requirePermission("ingest.run");

    assertValidObjectRef(mcnRef, "MCN");
    const mcn: IngestObjectRef = mcnRef;
    paths.push(mcn.path);

    let tap: IngestObjectRef | null = null;
    if (tapRef != null) {
      assertValidObjectRef(tapRef, "TAP");
      tap = tapRef;
      paths.push(tap.path);
    }

    // Optional "Master Data Shop" upload for the leak analysis (artifact's 3rd input).
    let master: IngestObjectRef | null = null;
    if (masterRef != null) {
      assertValidObjectRef(masterRef, "Master Data Shop");
      master = masterRef;
      paths.push(master.path);
    }

    const admin = createAdminClient();
    const mcnFile = await downloadIngestFile(admin, mcn);
    const tapFile = tap ? await downloadIngestFile(admin, tap) : null;
    const masterShopFile = master ? await downloadIngestFile(admin, master) : null;

    const result = await runIngest({ mcnFile, tapFile, masterShopFile, actorId: actor.id });

    revalidatePath("/ingest");
    revalidatePath("/link-leakage");
    revalidatePath("/workspace/cm");
    revalidatePath("/creators");
    revalidatePath("/dashboard");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  } finally {
    if (paths.length > 0) await removeIngestFiles(createAdminClient(), paths);
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac";
import { runIngest, type RunIngestResult } from "@/lib/ingest/run";

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

    const result = await runIngest({ mcnFile, tapFile, actorId: actor.id });

    revalidatePath("/ingest");
    // /link-leakage no longer touched by ingest (leak analysis is an external artifact).
    revalidatePath("/creators");
    revalidatePath("/dashboard");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

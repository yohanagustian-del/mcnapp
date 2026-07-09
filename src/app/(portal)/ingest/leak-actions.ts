"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac";
import { uploadLeakArtifact, type UploadLeakArtifactResult } from "@/lib/ingest/leak-run";

/**
 * Discriminated-union return (never throw across the server-action boundary): Next.js
 * censors a server action's thrown Error message in production ("An error occurred
 * in the Server Components render..."), so a pipeline rejection (format tak dikenali,
 * periode bukan W1-W5, ...) never reached the user — the root cause of the QA report
 * "upload gagal tanpa pesan apa pun terlihat". Every throw from the pipeline is
 * caught here and its message returned as `error` instead.
 */
export type UploadLeakArtifactActionResult =
  | { ok: true; result: UploadLeakArtifactResult }
  | { ok: false; error: string };

/**
 * Module 0.5 follow-up — upload the external "Agency Leaked Generator" artifact
 * (File 1 Leak Detail wajib + File 2 BD Opportunity opsional). Thin wrapper: RBAC +
 * FormData unpacking; the whole deterministic pipeline (parse → W1-W5 gate → resolve
 * creators → recompute rollup → creator_link_status + bd_leads → retention) lives in
 * src/lib/ingest/leak-run.ts. 0 token AI.
 */
export async function uploadLeakArtifactAction(
  formData: FormData
): Promise<UploadLeakArtifactActionResult> {
  try {
    const actor = await requirePermission("leak.upload_artifact");

    const leakRaw = formData.get("leak_file");
    if (!(leakRaw instanceof File) || leakRaw.size === 0) {
      throw new Error("File Leak Detail Report (artifak, wajib) belum diunggah");
    }
    const bdRaw = formData.get("bd_file");
    const bdFile = bdRaw instanceof File && bdRaw.size > 0 ? bdRaw : null;

    const result = await uploadLeakArtifact({ leakFile: leakRaw, bdFile, actorId: actor.id });

    revalidatePath("/ingest");
    revalidatePath("/workspace/cm");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

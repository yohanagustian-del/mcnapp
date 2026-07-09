"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac";
import { runShopeeIngest, type RunShopeeIngestResult } from "@/lib/ingest/shopee-run";

/**
 * Discriminated-union return (never throw across the server-action boundary —
 * same reasoning as runIngestAction in actions.ts: Next.js censors a server
 * action's thrown Error message in production).
 */
export type RunShopeeIngestActionResult =
  | { ok: true; result: RunShopeeIngestResult }
  | { ok: false; error: string };

/**
 * Shopee card entry point (Lane 1) — single Conversion Report file (gabungan
 * MCN + SAP). Thin wrapper: RBAC + FormData unpacking; the whole pipeline
 * (parse -> filter Selesai -> derive/validate W1-W5 window -> resolve creators
 * platform=shopee -> agregat GMV mingguan -> upload_batches + audit) lives in
 * src/lib/ingest/shopee-run.ts. Same permission gate as the TikTok card
 * (ingest.run) since both live on the same /ingest page section.
 */
export async function runShopeeIngestAction(formData: FormData): Promise<RunShopeeIngestActionResult> {
  try {
    const actor = await requirePermission("ingest.run");

    const file = formData.get("shopee_file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("File Conversion Report Shopee (gabungan MCN + SAP) wajib diunggah");
    }

    const result = await runShopeeIngest({ file, actorId: actor.id });

    revalidatePath("/ingest");
    revalidatePath("/creators");
    revalidatePath("/dashboard");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

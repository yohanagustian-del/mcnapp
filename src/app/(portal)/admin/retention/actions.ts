"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { assertWindowValid } from "@/lib/m12/retention";

/** §2.7 — Director sets retention.raw_window (months). Rejects < 28-day module minimum. */
export async function setRetentionWindow(formData: FormData): Promise<void> {
  const actor = await requirePermission("m12.set_policy");
  const months = Number(formData.get("months"));
  if (!Number.isFinite(months) || months <= 0) throw new Error("Jumlah bulan tidak valid");
  assertWindowValid(months * 30); // guard mirrors validate_retention_window (≥28 days)

  const admin = createAdminClient();
  const { error } = await admin.from("app_config")
    .update({ value: `"${months} months"` }).eq("key", "retention.raw_window");
  if (error) throw new Error(error.message);
  await writeAudit({
    actorId: actor.id, action: "m12.set_policy", entityType: "app_config", entityId: "retention.raw_window",
    after: { raw_window: `${months} months`, by: `director:${actor.id}` }, type: "approval",
  });
  revalidatePath("/admin/retention");
}

/** §3.1 — Director runs the retention purge (idempotent; window-guarded in SQL). */
export async function runRetentionPurge(): Promise<void> {
  const actor = await requirePermission("m12.run_maintenance");
  const admin = createAdminClient();
  const { error } = await admin.rpc("run_retention_purge");
  if (error) throw new Error(error.message);
  // run_retention_purge writes its own system:retention audit row; log the human trigger too.
  await writeAudit({
    actorId: actor.id, action: "m12.run_maintenance", entityType: "retention", type: "auto",
  });
  revalidatePath("/admin/retention");
}

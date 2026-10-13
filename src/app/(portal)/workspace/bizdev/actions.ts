"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";

/**
 * BizDev memproses req dari semua CM (§2B.1): diajukan → diproses → selesai.
 * Req ads yang menunggu approval Director tidak boleh diproses dulu (§6.4).
 */
export async function processCreatorRequest(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.request_process");
  const reqId = Number(formData.get("req_id"));
  const status = String(formData.get("status"));
  if (!reqId || !["diproses", "selesai"].includes(status)) throw new Error("Status req tidak valid");

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("creator_requests").select("id, status, approval_status, type").eq("id", reqId).maybeSingle();
  if (!req) throw new Error(`Req #${reqId} tidak ditemukan`);
  if (req.approval_status === "menunggu") {
    throw new Error("Req ads masih menunggu approval Director — belum bisa diproses");
  }
  const validFrom: Record<string, string> = { diproses: "diajukan", selesai: "diproses" };
  if (req.status !== validFrom[status]) {
    throw new Error(`Transisi tidak valid: ${req.status} → ${status}`);
  }

  const { error } = await admin
    .from("creator_requests")
    .update({ status, processed_by: actor.id, updated_at: new Date().toISOString() })
    .eq("id", reqId);
  if (error) throw new Error(`Gagal update req: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.request_process", entityType: "creator_requests",
    entityId: String(reqId), before: { status: req.status }, after: { status }, type: "auto",
  });
  revalidatePath("/workspace/bizdev");
  revalidatePath("/workspace/cm");
}

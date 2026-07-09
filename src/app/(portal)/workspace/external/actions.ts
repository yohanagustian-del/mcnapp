"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";

/** Log approach creator external (§2D.1) — basis metrik success rate. */
export async function recordApproach(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.external");
  const creatorName = String(formData.get("creator_name") ?? "").trim();
  const creatorId = String(formData.get("creator_id") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!creatorName) throw new Error("Nama creator wajib diisi");

  const admin = createAdminClient();
  if (creatorId) {
    const { data: creator } = await admin.from("creators").select("id").eq("id", creatorId).maybeSingle();
    if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan — kosongkan bila belum terdaftar`);
  }

  const { data: row, error } = await admin
    .from("external_approaches")
    .insert({ creator_name: creatorName, creator_id: creatorId, approached_by: actor.id, notes })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal mencatat approach: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.external_approach", entityType: "external_approaches",
    entityId: String(row.id), after: { creator_name: creatorName, creator_id: creatorId }, type: "auto",
  });
  revalidatePath("/workspace/external");
}

/** Update hasil approach: deal pakai link TAP (sukses) / batal. */
export async function updateApproachStatus(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.external");
  const approachId = Number(formData.get("approach_id"));
  const status = String(formData.get("status"));
  if (!approachId || !["pakai_link", "batal"].includes(status)) {
    throw new Error("Status approach tidak valid");
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("external_approaches").select("id, status").eq("id", approachId).maybeSingle();
  if (!row) throw new Error(`Approach #${approachId} tidak ditemukan`);
  if (row.status !== "approach") throw new Error(`Approach sudah berstatus ${row.status}`);

  const { error } = await admin
    .from("external_approaches").update({ status }).eq("id", approachId);
  if (error) throw new Error(`Gagal update: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.external_approach_status", entityType: "external_approaches",
    entityId: String(approachId), before: { status: row.status }, after: { status }, type: "auto",
  });
  revalidatePath("/workspace/external");
}

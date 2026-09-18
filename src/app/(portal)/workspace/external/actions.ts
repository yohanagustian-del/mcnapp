"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { externalApproachSchema, toWaContact } from "@/lib/workspace/external-approach";

export interface ApproachFormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

function fieldErrorsFrom(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] = issue.message;
  return out;
}

/** Maps the validated form shape onto `external_approaches` DB columns (creator_name/approach_date legacy names kept). */
function toRow(v: ReturnType<typeof externalApproachSchema.parse>) {
  return {
    creator_name: v.username,
    brand: v.brand,
    creator_id: v.creator_id ?? null,
    niche: v.niche ?? null,
    platform: v.platform ?? null,
    followers: v.followers ?? null,
    wa_contact: toWaContact(v.wa_number),
    gmv: v.gmv ?? null,
    channel: v.channel ?? null,
    approach_date: v.scouting_date ?? null,
    reachout_date: v.reachout_date ?? null,
    respon_date: v.respon_date ?? null,
    follow_up_1_date: v.follow_up_1_date ?? null,
    follow_up_2_date: v.follow_up_2_date ?? null,
    follow_up_3_date: v.follow_up_3_date ?? null,
    using_tap_date: v.using_tap_date ?? null,
    prove_link: v.prove_link ?? null,
    notes: v.notes ?? null,
  };
}

async function assertCreatorExists(creatorId: string | null): Promise<string | null> {
  if (!creatorId) return null;
  const admin = createAdminClient();
  const { data: creator } = await admin.from("creators").select("id").eq("id", creatorId).maybeSingle();
  return creator ? null : `Creator ${creatorId} tidak ditemukan — kosongkan bila belum terdaftar`;
}

/** Catat entry baru pipeline scouting external creator (§2D.1). */
export async function createApproach(_prev: ApproachFormState | null, formData: FormData): Promise<ApproachFormState> {
  const actor = await requirePermission("m8.external");
  const parsed = externalApproachSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const creatorIdError = await assertCreatorExists(parsed.data.creator_id ?? null);
  if (creatorIdError) return { ok: false, message: creatorIdError, fieldErrors: { creator_id: creatorIdError } };

  const row = toRow(parsed.data);
  if (!row.approach_date) delete (row as Record<string, unknown>).approach_date; // let DB default (current_date) apply

  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from("external_approaches")
    .insert({ ...row, approached_by: actor.id })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Gagal menyimpan: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "m8.external_approach_create",
    entityType: "external_approaches",
    entityId: String(inserted.id),
    after: row,
    type: "auto",
  });
  revalidatePath("/workspace/external");
  return { ok: true, message: "Approach tersimpan." };
}

/** Edit satu baris pipeline scouting (semua kolom, termasuk tahapan tanggal). */
export async function updateApproach(_prev: ApproachFormState | null, formData: FormData): Promise<ApproachFormState> {
  const actor = await requirePermission("m8.external");
  const id = Number(formData.get("id"));
  if (!id) return { ok: false, message: "ID tidak valid." };

  const parsed = externalApproachSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const creatorIdError = await assertCreatorExists(parsed.data.creator_id ?? null);
  if (creatorIdError) return { ok: false, message: creatorIdError, fieldErrors: { creator_id: creatorIdError } };

  const admin = createAdminClient();
  const { data: before } = await admin.from("external_approaches").select("*").eq("id", id).maybeSingle();
  if (!before) return { ok: false, message: `Approach #${id} tidak ditemukan.` };

  const after = toRow(parsed.data);
  const { error } = await admin.from("external_approaches").update(after).eq("id", id);
  if (error) return { ok: false, message: `Gagal update: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "m8.external_approach_update",
    entityType: "external_approaches",
    entityId: String(id),
    before,
    after,
    type: "auto",
  });
  revalidatePath("/workspace/external");
  return { ok: true, message: "Approach diperbarui." };
}

/** Hapus satu baris — seluruh isi baris ditulis ke audit_logs sebelum dihapus (CLAUDE.md #2). */
export async function deleteApproach(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.external");
  const id = Number(formData.get("id"));
  if (!id) throw new Error("ID tidak valid");

  const admin = createAdminClient();
  const { data: before } = await admin.from("external_approaches").select("*").eq("id", id).maybeSingle();
  if (!before) throw new Error(`Approach #${id} tidak ditemukan`);

  const { error } = await admin.from("external_approaches").delete().eq("id", id);
  if (error) throw new Error(`Gagal hapus: ${error.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "m8.external_approach_delete",
    entityType: "external_approaches",
    entityId: String(id),
    before,
    type: "auto",
  });
  revalidatePath("/workspace/external");
}

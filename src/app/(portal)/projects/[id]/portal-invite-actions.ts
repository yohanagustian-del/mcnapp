"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";

/**
 * Undang peserta ke Creator Portal (PRD R36, K8: manual oleh CPM, tanpa Sebari).
 * Gated `m7.curate` — satu-satunya permission M7 yang memuat role `cpm` polos
 * (m7.manage/m7.metrics tidak), sesuai R36 yang eksplisit menyebut CPM.
 *
 * SCOPE NOTE: ini hanya membuat baris `creator_users` (status 'invited' +
 * token) dan menampilkan tokennya — repo ini BELUM punya halaman konsumsi
 * token (set password → auth_uid ter-link) di mana pun (dicek: tidak ada
 * route /join, /invite, /activate). Itu infrastruktur M9 yang sudah ada
 * skemanya (creator_users.invite_token) tapi belum ada sisi penerimanya;
 * membangunnya bukan scope M7 v2 — tim mengirim token ini manual sesuai
 * proses yang sudah berjalan, sampai halaman aktivasi itu dibangun.
 */
export type InvitePortalResult =
  | { ok: true; token: string; alreadyInvited: boolean }
  | { ok: false; error: string };

export async function invitePortalAccount(formData: FormData): Promise<InvitePortalResult> {
  try {
    const actor = await requirePermission("m7.curate");
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!creatorId) throw new Error("Kreator tidak valid");

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("creator_users").select("id, status, invite_token").eq("creator_id", creatorId).maybeSingle();
    if (existing) {
      return { ok: true, token: existing.invite_token ?? "", alreadyInvited: true };
    }
    if (!email) throw new Error("Email kreator wajib diisi untuk undangan pertama");

    const token = randomBytes(24).toString("hex");
    const { error } = await admin.from("creator_users").insert({
      creator_id: creatorId, email, status: "invited", invite_token: token, invited_by: actor.id,
    });
    if (error) throw new Error(`Gagal membuat undangan: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "m7.portal_invite", entityType: "creator_users", entityId: creatorId,
      after: { email, status: "invited" }, type: "auto",
    });

    revalidatePath("/projects");
    return { ok: true, token, alreadyInvited: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

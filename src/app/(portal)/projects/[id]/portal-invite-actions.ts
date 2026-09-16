"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { resolveOrigin } from "@/lib/auth/origin";

/**
 * Undang peserta ke Creator Portal (PRD R36, K8: manual oleh CPM, tanpa Sebari).
 * Gated `m7.curate` — satu-satunya permission M7 yang memuat role `cpm` polos
 * (m7.manage/m7.metrics tidak), sesuai R36 yang eksplisit menyebut CPM.
 *
 * Membuat baris `creator_users` (status 'invited' + token) dan mengembalikan
 * link `/aktivasi?token=...` siap kirim (CPM masih mengirimnya manual via WA
 * — K8, tidak ada integrasi Sebari). Halaman `/aktivasi` (src/app/aktivasi/)
 * yang menukar token itu jadi akun aktif.
 */
export type InvitePortalResult =
  | { ok: true; link: string; alreadyActive: boolean }
  | { ok: false; error: string };

export async function invitePortalAccount(formData: FormData): Promise<InvitePortalResult> {
  try {
    const actor = await requirePermission("m7.curate");
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!creatorId) throw new Error("Kreator tidak valid");

    const admin = createAdminClient();
    const origin = await resolveOrigin();
    const { data: existing } = await admin
      .from("creator_users").select("id, status, invite_token").eq("creator_id", creatorId).maybeSingle();
    if (existing) {
      if (existing.status === "active") return { ok: true, link: "", alreadyActive: true };
      // Still 'invited' (or 'suspended') — re-show the same token's link rather
      // than minting a new one, so an earlier link sent to the creator stays valid.
      return { ok: true, link: `${origin}/aktivasi?token=${existing.invite_token}`, alreadyActive: false };
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
    return { ok: true, link: `${origin}/aktivasi?token=${token}`, alreadyActive: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

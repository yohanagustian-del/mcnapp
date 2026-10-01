"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { resolveOrigin } from "@/lib/auth/origin";
import { assertCreatorInScope } from "@/lib/schedule/scope";

/**
 * Creator Portal invite (PRD R36, K8: manual by staff, no Sebari) — the ONE
 * implementation, shared by the Special Project participant table and the
 * creator detail header (and later CM Workspace) via <PortalInviteButton>.
 *
 * Gated `m9.invite` (management + CM + Acquisition). Scope via
 * assertCreatorInScope: a `cpm` may only invite creators they own
 * (creators.owner_cpm_id); every other permitted role has full scope.
 *
 * Creates a `creator_users` row (status 'invited' + token) and returns the
 * `/aktivasi?token=...` link to send manually (WA — K8). The `/aktivasi` page
 * (src/app/aktivasi/) exchanges that token for an active account.
 */
export type InvitePortalResult =
  | { ok: true; link: string; alreadyActive: boolean }
  | { ok: false; error: string };

/** Portal account state of a creator; `null` in loadPortalStatus = never invited. */
export type PortalAccountStatus = "invited" | "active" | "suspended";

export async function invitePortalAccount(formData: FormData): Promise<InvitePortalResult> {
  try {
    const actor = await requirePermission("m9.invite");
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!creatorId) throw new Error("Kreator tidak valid");

    const admin = createAdminClient();
    await assertCreatorInScope(admin, actor, creatorId, "mengundang ke portal");
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
    revalidatePath(`/creators/${creatorId}`);
    return { ok: true, link: `${origin}/aktivasi?token=${token}`, alreadyActive: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Portal account status per creator id (missing key = never invited).
 *
 * `creator_users` RLS (`cu_self_read`) only lets a creator read their own row,
 * so staff reading it with the session client always got zero rows and every
 * creator showed as "belum diundang". Read with the service-role client
 * instead, authorized in code: only `m9.invite` holders — the same people who
 * see the invite button — may load it.
 */
export async function loadPortalStatus(
  creatorIds: string[]
): Promise<Record<string, PortalAccountStatus>> {
  await requirePermission("m9.invite");
  const ids = [...new Set(creatorIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await createAdminClient()
    .from("creator_users").select("creator_id, status").in("creator_id", ids);
  if (error) throw new Error(`Gagal memuat status akun portal: ${error.message}`);
  const out: Record<string, PortalAccountStatus> = {};
  for (const r of data ?? []) out[r.creator_id as string] = r.status as PortalAccountStatus;
  return out;
}

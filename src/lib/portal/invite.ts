"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { hasPermission, requireMember } from "@/lib/rbac";
import { resolveOrigin } from "@/lib/auth/origin";
import { isValidEmail, normalizeEmail } from "@/lib/auth/password-reset";
import { assertCreatorInScope } from "@/lib/schedule/scope";
import { portalInviteGate } from "./invite-gate";
import { generateTempPassword } from "./temp-password";
import type { PortalCredentials } from "./credentials";

/**
 * Creator Portal invite + staff password reset (PRD R36, K8: manual by staff, no
 * Sebari) — the ONE implementation, shared by the Special Project participant table,
 * the creator detail header and CM Workspace via <PortalInviteButton>.
 *
 * Since 2026-10-01 (user decision, option A+B) an invite no longer sends an
 * /aktivasi link: it creates the Supabase Auth user right away with a UNIQUE
 * temporary password (generateTempPassword), which staff send over WA. The creator
 * logs in with it and requireCreator() forces a new password first
 * (creator_users.must_change_password, migration 0085). "Reset Password" mints a
 * new temporary password the same way. The password is returned once to the
 * caller and never stored or audited.
 *
 * Gate = portalInviteGate(): `m9.invite` (management + CM + Acquisition) may invite
 * any creator; `m7.curate`-only roles (bizdev, campaign_ops — Q5) only a participant
 * of the Special Project passed as `project_id`. Reset Password = `m9.invite` only.
 * Scope via assertCreatorInScope: a `cpm` may only act on creators they own.
 */
export type InvitePortalResult =
  | { ok: true; credentials: PortalCredentials | null; alreadyActive: boolean }
  | { ok: false; error: string };

/** Portal account state of a creator; `null` in loadPortalStatus = never invited. */
export type PortalAccountStatus = "invited" | "active" | "suspended";

type CreatorUserRow = { id: string; email: string; status: string; auth_uid: string | null };

/** Find an existing Supabase Auth user by email (admin API has no direct lookup). */
async function findAuthUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Gagal memeriksa akun: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/**
 * Set `password` on the creator's auth user, creating it when needed. Never touches
 * a team member's login: an email that belongs to internal staff is refused.
 * Returns the auth uid and whether this call created it (for cleanup on failure).
 */
async function provisionAuthUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  existingAuthUid: string | null
): Promise<{ authUid: string; created: boolean }> {
  if (existingAuthUid) {
    // Legacy /aktivasi could link a creator row to an existing auth user; never
    // reset a password that is also an internal staff login.
    const { data: staffLogin } = await admin.from("team_members").select("id").eq("id", existingAuthUid).maybeSingle();
    if (staffLogin) throw new Error("Akun portal ini tertaut ke akun tim internal — hubungi Management.");
    const { error } = await admin.auth.admin.updateUserById(existingAuthUid, { password });
    if (error) throw new Error(`Gagal menyetel password sementara: ${error.message}`);
    return { authUid: existingAuthUid, created: false };
  }
  const { data: staff } = await admin.from("team_members").select("id").eq("email", email).limit(1);
  if (staff?.length) throw new Error("Email ini dipakai akun tim internal — pakai email lain untuk kreator.");

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return { authUid: data.user.id, created: true };
  // An orphan auth user with this email (e.g. an earlier half-finished invite):
  // reuse it rather than failing (same defensive pattern as /aktivasi).
  const orphan = await findAuthUserIdByEmail(admin, email);
  if (!orphan) throw new Error(`Gagal membuat akun: ${error.message}`);
  const { error: updError } = await admin.auth.admin.updateUserById(orphan, { password });
  if (updError) throw new Error(`Gagal menyetel password sementara: ${updError.message}`);
  return { authUid: orphan, created: false };
}

async function credentialsFor(
  admin: SupabaseClient,
  creatorId: string,
  email: string,
  password: string
): Promise<PortalCredentials> {
  const { data: creator } = await admin.from("creators").select("name").eq("id", creatorId).maybeSingle();
  return {
    creatorName: (creator?.name as string | undefined) ?? "Kreator",
    loginUrl: `${await resolveOrigin()}/login?portal=creator`,
    email,
    password,
  };
}

/** Mint + set a new temporary password on an existing creator_users row. */
async function issueTempPassword(admin: SupabaseClient, cu: CreatorUserRow): Promise<string> {
  const password = generateTempPassword();
  const { authUid } = await provisionAuthUser(admin, cu.email, password, cu.auth_uid);
  const { error } = await admin
    .from("creator_users")
    .update({
      auth_uid: authUid,
      must_change_password: true,
      temp_password_set_at: new Date().toISOString(),
      invite_token: null, // a legacy /aktivasi link stops working once a temp password exists
    })
    .eq("id", cu.id);
  if (error) throw new Error(`Gagal menyimpan status akun: ${error.message}`);
  return password;
}

export async function invitePortalAccount(formData: FormData): Promise<InvitePortalResult> {
  try {
    const actor = await requireMember();
    const gate = portalInviteGate(actor.role);
    if (!gate) throw new Error(`Akses ditolak: role ${actor.role} tidak boleh mengundang ke portal`);
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    const email = normalizeEmail(formData.get("email"));
    const projectId = String(formData.get("project_id") ?? "").trim();
    if (!creatorId) throw new Error("Kreator tidak valid");

    const admin = createAdminClient();
    if (gate === "project") {
      // Project-only inviters: the creator must be a participant of the project the
      // invite is sent from (never an arbitrary creator id).
      if (!projectId) throw new Error("Akses ditolak: undangan hanya bisa dikirim dari peserta Special Project");
      const { data: participant, error: pErr } = await admin
        .from("project_participants").select("creator_id")
        .eq("project_id", projectId).eq("creator_id", creatorId).maybeSingle();
      if (pErr) throw new Error(`Gagal memeriksa peserta project: ${pErr.message}`);
      if (!participant) throw new Error("Akses ditolak: kreator bukan peserta project ini");
    }
    await assertCreatorInScope(admin, actor, creatorId, "mengundang ke portal");

    const { data: existing } = await admin
      .from("creator_users").select("id, email, status, auth_uid").eq("creator_id", creatorId).maybeSingle();
    if (existing) {
      if (existing.status === "active") return { ok: true, credentials: null, alreadyActive: true };
      if (existing.status === "suspended") throw new Error("Akun portal kreator ini ditangguhkan.");
      // Still 'invited' (never logged in): mint a fresh temporary password — the
      // earlier one cannot be shown again because it is never stored.
      const password = await issueTempPassword(admin, existing as CreatorUserRow);
      await writeAudit({
        actorId: actor.id, action: "m9.portal_invite_reissue", entityType: "creator_users", entityId: creatorId,
        after: { email: existing.email, must_change_password: true, project_id: projectId || null }, type: "auto",
      });
      return { ok: true, credentials: await credentialsFor(admin, creatorId, existing.email, password), alreadyActive: false };
    }

    if (!email) throw new Error("Email kreator wajib diisi untuk undangan pertama");
    if (!isValidEmail(email)) throw new Error("Format email tidak valid");
    const { data: taken } = await admin.from("creator_users").select("creator_id").eq("email", email).maybeSingle();
    if (taken) throw new Error("Email ini sudah dipakai akun portal kreator lain.");

    const password = generateTempPassword();
    const { authUid, created } = await provisionAuthUser(admin, email, password, null);
    const { error } = await admin.from("creator_users").insert({
      creator_id: creatorId, email, status: "invited", auth_uid: authUid, invited_by: actor.id,
      must_change_password: true, temp_password_set_at: new Date().toISOString(),
    });
    if (error) {
      if (created) await admin.auth.admin.deleteUser(authUid);
      throw new Error(`Gagal membuat undangan: ${error.message}`);
    }

    await writeAudit({
      actorId: actor.id, action: "m7.portal_invite", entityType: "creator_users", entityId: creatorId,
      after: { email, status: "invited", must_change_password: true, project_id: projectId || null }, type: "auto",
    });

    revalidatePath("/projects");
    revalidatePath(`/creators/${creatorId}`);
    return { ok: true, credentials: await credentialsFor(admin, creatorId, email, password), alreadyActive: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Staff "Reset Password" for a creator who forgot theirs or has no working email
 * (option B): mints a new temporary password, sets it, and forces a change on the
 * next login. `m9.invite` only (not the project-only inviters), CPM scoped to own
 * creators. Audit `auto` without the password itself.
 */
export async function resetPortalPassword(formData: FormData): Promise<InvitePortalResult> {
  try {
    const actor = await requireMember();
    if (!hasPermission("m9.invite", actor.role)) {
      throw new Error(`Akses ditolak: role ${actor.role} tidak boleh mereset password kreator`);
    }
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    if (!creatorId) throw new Error("Kreator tidak valid");

    const admin = createAdminClient();
    await assertCreatorInScope(admin, actor, creatorId, "mereset password portal");
    const { data: cu } = await admin
      .from("creator_users").select("id, email, status, auth_uid").eq("creator_id", creatorId).maybeSingle();
    if (!cu) throw new Error("Kreator ini belum punya akun portal — pakai Undang ke Portal.");
    if (cu.status === "suspended") throw new Error("Akun portal kreator ini ditangguhkan.");

    const password = await issueTempPassword(admin, cu as CreatorUserRow);
    await writeAudit({
      actorId: actor.id, action: "m9.portal_password_reset", entityType: "creator_users", entityId: creatorId,
      after: { email: cu.email, must_change_password: true }, type: "auto",
    });

    revalidatePath(`/creators/${creatorId}`);
    return { ok: true, credentials: await credentialsFor(admin, creatorId, cu.email, password), alreadyActive: false };
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
 * instead, authorized in code: only roles with invite rights (portalInviteGate) —
 * the same people who see the invite button — may load it.
 */
export async function loadPortalStatus(
  creatorIds: string[]
): Promise<Record<string, PortalAccountStatus>> {
  const member = await requireMember();
  if (!portalInviteGate(member.role)) {
    throw new Error(`Akses ditolak: role ${member.role} tidak boleh melihat status akun portal`);
  }
  const ids = [...new Set(creatorIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await createAdminClient()
    .from("creator_users").select("creator_id, status").in("creator_id", ids);
  if (error) throw new Error(`Gagal memuat status akun portal: ${error.message}`);
  const out: Record<string, PortalAccountStatus> = {};
  for (const r of data ?? []) out[r.creator_id as string] = r.status as PortalAccountStatus;
  return out;
}

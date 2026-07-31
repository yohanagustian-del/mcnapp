"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission, type Role } from "@/lib/rbac";
import { ROLE_LABELS } from "@/lib/tim/roles";
import {
  BLOCKING_REFERENCES,
  diffMember,
  formatBlockingMessage,
  formatForeignKeyError,
  formatIssues,
  memberCreateSchema,
  memberLabel,
  memberUpdateSchema,
  readMemberFields,
  summarizeProposal,
  type EditableField,
  type ProposalKind,
} from "@/lib/tim/member-admin";
import { generateTempPassword } from "@/lib/tim/temp-password";

/**
 * Manajemen user tim: tambah, ganti jabatan, nonaktifkan, hapus permanen.
 *
 * Eksekusi = Director saja (m11.manage_accounts). OD (od_viewer) hanya bisa MENGAJUKAN
 * usulan lewat proposeMemberChange — baris usulan tidak mengubah apa pun sampai Director
 * memutuskan. Setiap mutasi ditulis ke audit_logs (CLAUDE.md #2).
 */

export type MemberActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Password sementara user baru — dikembalikan SEKALI untuk ditampilkan ke Director. */
  tempPassword?: string;
  tempPasswordEmail?: string;
} | null;

/** Pesan trigger DB `guard_last_director` diterjemahkan ke bahasa yang dimengerti user. */
function translateDbError(message: string): string {
  if (message.includes("last active Director")) {
    return "Ditolak: ini Director aktif terakhir. Sistem harus selalu punya minimal 1 Director aktif — angkat Director lain dulu.";
  }
  return message;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  team_group: string;
  platform_segment: string | null;
  active: boolean;
}

const MEMBER_COLUMNS = "id, name, email, role, team_group, platform_segment, active";

// ---------------------------------------------------------------------------
// Eksekusi (dipakai aksi langsung Director maupun saat Director menyetujui usulan OD)
// ---------------------------------------------------------------------------

async function applyCreate(
  actorId: string,
  input: { name: string; email: string; role: Role; team_group: string; platform_segment: string | null }
): Promise<MemberActionState> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("team_members")
    .select("id")
    .eq("email", input.email)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: `Email ${input.email} sudah terdaftar sebagai anggota tim.` };
  }

  const tempPassword = generateTempPassword();

  // team_members.id mereferensikan auth.users(id) → akun auth harus ada lebih dulu.
  let userId: string;
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError) {
    // Email bisa sudah punya akun auth tanpa baris team_members (mis. sisa upload yang gagal
    // di tengah jalan). Pakai akun itu dan set ulang password sementaranya.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = list?.users.find((u) => u.email?.toLowerCase() === input.email);
    if (!match) return { ok: false, error: `Gagal membuat akun login: ${authError.message}` };
    userId = match.id;
    const { error: pwError } = await admin.auth.admin.updateUserById(userId, {
      password: tempPassword,
      email_confirm: true,
    });
    if (pwError) return { ok: false, error: `Gagal menyetel password sementara: ${pwError.message}` };
  } else {
    userId = created.user.id;
  }

  const { error: insertError } = await admin.from("team_members").insert({
    id: userId,
    name: input.name,
    email: input.email,
    role: input.role,
    team_group: input.team_group,
    platform_segment: input.platform_segment,
    active: true,
    must_change_password: true,
  });
  if (insertError) {
    return { ok: false, error: translateDbError(insertError.message) };
  }

  await writeAudit({
    actorId,
    action: "team_member.create",
    entityType: "team_members",
    entityId: userId,
    before: null,
    // Password sementara TIDAK PERNAH ditulis ke audit_logs.
    after: { ...input, active: true },
    type: "auto",
  });

  return {
    ok: true,
    message: `${input.name} ditambahkan sebagai ${ROLE_LABELS[input.role]}.`,
    tempPassword,
    tempPasswordEmail: input.email,
  };
}

async function applyUpdate(
  actorId: string,
  targetId: string,
  input: {
    name: string;
    role: Role;
    team_group: string;
    platform_segment: string | null;
    active: boolean;
  }
): Promise<MemberActionState> {
  const admin = createAdminClient();

  const { data: before } = await admin
    .from("team_members")
    .select(MEMBER_COLUMNS)
    .eq("id", targetId)
    .maybeSingle<MemberRow>();
  if (!before) return { ok: false, error: "Anggota tim tidak ditemukan." };

  const changes = diffMember(
    before as unknown as Partial<Record<EditableField, unknown>>,
    input as unknown as Partial<Record<EditableField, unknown>>
  );
  if (changes.length === 0) return { ok: true, message: "Tidak ada perubahan." };

  const { error } = await admin
    .from("team_members")
    .update({
      name: input.name,
      role: input.role,
      team_group: input.team_group,
      platform_segment: input.platform_segment,
      active: input.active,
    })
    .eq("id", targetId);
  if (error) return { ok: false, error: translateDbError(error.message) };

  await writeAudit({
    actorId,
    action: "team_member.update",
    entityType: "team_members",
    entityId: targetId,
    before: {
      name: before.name,
      role: before.role,
      team_group: before.team_group,
      platform_segment: before.platform_segment,
      active: before.active,
    },
    after: input,
    // Ganti jabatan / nonaktifkan = aksi manusia yang berdampak ke orang & akses.
    type: "approval",
  });

  return {
    ok: true,
    message: `Tersimpan: ${changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(", ")}.`,
  };
}

async function applyDeactivate(actorId: string, targetId: string): Promise<MemberActionState> {
  const admin = createAdminClient();
  const { data: before } = await admin
    .from("team_members")
    .select(MEMBER_COLUMNS)
    .eq("id", targetId)
    .maybeSingle<MemberRow>();
  if (!before) return { ok: false, error: "Anggota tim tidak ditemukan." };
  if (!before.active) return { ok: true, message: `${before.name} memang sudah nonaktif.` };

  const { error } = await admin.from("team_members").update({ active: false }).eq("id", targetId);
  if (error) return { ok: false, error: translateDbError(error.message) };

  await writeAudit({
    actorId,
    action: "team_member.deactivate",
    entityType: "team_members",
    entityId: targetId,
    before: { active: true },
    after: { active: false },
    type: "approval",
  });
  return { ok: true, message: `${before.name} dinonaktifkan — tidak bisa login lagi.` };
}

/**
 * Hapus permanen: baris team_members + akun auth benar-benar hilang.
 *
 * Migrasi 0028 sudah menyetel ON DELETE SET NULL untuk FK nullable dan CASCADE untuk
 * telemetri page-view, jadi jejak bisnis tetap ada tanpa pelakunya. FK NOT NULL
 * (BLOCKING_REFERENCES) sengaja tetap menolak: itu catatan bisnis yang wajib punya
 * pelaku, dan menghapusnya berarti menghapus data operasional — dicek di muka supaya
 * Director tahu persis apa yang menghalangi, bukan sekadar kena error constraint.
 */
async function applyDelete(actorId: string, targetId: string): Promise<MemberActionState> {
  const admin = createAdminClient();

  const { data: before } = await admin
    .from("team_members")
    .select(MEMBER_COLUMNS)
    .eq("id", targetId)
    .maybeSingle<MemberRow>();
  if (!before) return { ok: false, error: "Anggota tim tidak ditemukan." };

  const counts = [];
  for (const ref of BLOCKING_REFERENCES) {
    const { count } = await admin
      .from(ref.table)
      .select("*", { count: "exact", head: true })
      .eq(ref.column, targetId);
    counts.push({ label: ref.label, count: count ?? 0 });
  }
  const blocking = formatBlockingMessage(before.name, counts);
  if (blocking) return { ok: false, error: blocking };

  // Audit ditulis SEBELUM baris hilang, memuat snapshot lengkap.
  await writeAudit({
    actorId,
    action: "team_member.delete",
    entityType: "team_members",
    entityId: targetId,
    before,
    after: null,
    type: "approval",
  });

  // Selamatkan identitas pelaku di audit_logs miliknya: audit_logs.actor_id akan
  // dijadikan null oleh ON DELETE SET NULL, jadi siapa pelakunya dipindahkan ke
  // actor_label lebih dulu (pola yang sama dipakai principal non-team_members).
  await admin
    .from("audit_logs")
    .update({ actor_label: `deleted_member:${before.email}` })
    .eq("actor_id", targetId)
    .is("actor_label", null);

  // Usulan OD yang masih menunggu untuk user ini jadi tidak relevan.
  await admin
    .from("member_change_requests")
    .update({ status: "cancelled", decision_note: "Target sudah dihapus permanen." })
    .eq("target_member_id", targetId)
    .eq("status", "pending");

  const { error: delError } = await admin.from("team_members").delete().eq("id", targetId);
  if (delError) {
    // Jaring pengaman: FK NOT NULL di luar BLOCKING_REFERENCES (mis. tabel baru).
    const message =
      delError.code === "23503"
        ? formatForeignKeyError(before.name, delError.message)
        : translateDbError(delError.message);
    return { ok: false, error: message };
  }

  const { error: authError } = await admin.auth.admin.deleteUser(targetId);
  if (authError) {
    return {
      ok: true,
      message: `${before.name} dihapus dari tim, tapi akun login-nya gagal dihapus (${authError.message}). Akun itu sudah tidak punya akses ke portal.`,
    };
  }

  return { ok: true, message: `${before.name} dihapus permanen beserta akun login-nya.` };
}

// ---------------------------------------------------------------------------
// Aksi langsung Director
// ---------------------------------------------------------------------------

export async function createMember(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("m11.manage_accounts");
  const parsed = memberCreateSchema.safeParse(readMemberFields(formData));
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };

  const result = await applyCreate(actor.id, parsed.data);
  revalidatePath("/tim");
  return result;
}

export async function updateMember(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("m11.manage_accounts");
  const targetId = String(formData.get("member_id") ?? "");
  if (!targetId) return { ok: false, error: "Anggota tim tidak dikenali." };

  const parsed = memberUpdateSchema.safeParse(readMemberFields(formData));
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };

  // Menurunkan jabatan diri sendiri boleh (Director lain masih ada, dijaga trigger),
  // tapi mengunci diri sendiri di luar portal hampir selalu tidak disengaja.
  if (targetId === actor.id && !parsed.data.active) {
    return { ok: false, error: "Tidak bisa menonaktifkan akun sendiri. Minta Director lain melakukannya." };
  }

  const result = await applyUpdate(actor.id, targetId, parsed.data);
  revalidatePath("/tim");
  return result;
}

export async function deactivateMember(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("m11.manage_accounts");
  const targetId = String(formData.get("member_id") ?? "");
  if (!targetId) return { ok: false, error: "Anggota tim tidak dikenali." };
  if (targetId === actor.id) {
    return { ok: false, error: "Tidak bisa menonaktifkan akun sendiri. Minta Director lain melakukannya." };
  }
  const result = await applyDeactivate(actor.id, targetId);
  revalidatePath("/tim");
  return result;
}

export async function deleteMember(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("m11.manage_accounts");
  const targetId = String(formData.get("member_id") ?? "");
  if (!targetId) return { ok: false, error: "Anggota tim tidak dikenali." };
  if (targetId === actor.id) {
    return { ok: false, error: "Tidak bisa menghapus akun sendiri. Minta Director lain melakukannya." };
  }
  const result = await applyDelete(actor.id, targetId);
  revalidatePath("/tim");
  return result;
}

// ---------------------------------------------------------------------------
// Usulan OD → keputusan Director
// ---------------------------------------------------------------------------

export type ProposalActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Terisi saat Director menyetujui usulan "tambah user" — password sementara tampil sekali. */
  tempPassword?: string;
  tempPasswordEmail?: string;
} | null;

/**
 * OD mengajukan usulan. Insert sengaja lewat klien user (bukan service role) supaya
 * policy RLS `mcr_insert_od` ikut menguji siapa yang mengajukan — od_viewer tetap tidak
 * punya jalur tulis apa pun ke team_members.
 */
export async function proposeMemberChange(
  _prev: ProposalActionState,
  formData: FormData
): Promise<ProposalActionState> {
  const actor = await requirePermission("m11.propose_account_change");

  const kind = String(formData.get("kind") ?? "") as ProposalKind;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!["create", "update", "deactivate", "delete"].includes(kind)) {
    return { ok: false, error: "Jenis usulan tidak dikenal." };
  }
  if (reason.length < 10) {
    return { ok: false, error: "Alasan wajib diisi, minimal 10 karakter — Director perlu dasar keputusan." };
  }

  const raw = readMemberFields(formData);
  const admin = createAdminClient();

  let targetId: string | null = null;
  let targetLabel: string;
  let payload: Record<string, unknown> = {};

  if (kind === "create") {
    const parsed = memberCreateSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
    targetLabel = memberLabel(parsed.data);
    payload = parsed.data;
  } else {
    targetId = String(formData.get("member_id") ?? "");
    if (!targetId) return { ok: false, error: "Pilih anggota tim yang diusulkan." };
    const { data: target } = await admin
      .from("team_members")
      .select(MEMBER_COLUMNS)
      .eq("id", targetId)
      .maybeSingle<MemberRow>();
    if (!target) return { ok: false, error: "Anggota tim tidak ditemukan." };
    targetLabel = memberLabel(target);

    if (kind === "update") {
      const parsed = memberUpdateSchema.safeParse({ ...raw, active: target.active });
      if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
      const changes = diffMember(
        target as unknown as Partial<Record<EditableField, unknown>>,
        parsed.data as unknown as Partial<Record<EditableField, unknown>>
      );
      if (changes.length === 0) {
        return { ok: false, error: "Tidak ada perubahan yang diusulkan." };
      }
      payload = parsed.data;
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("member_change_requests").insert({
    kind,
    target_member_id: targetId,
    target_label: targetLabel,
    payload,
    reason,
    status: "pending",
    requested_by: actor.id,
    requested_by_label: memberLabel(actor),
  });
  if (error) return { ok: false, error: `Gagal mengirim usulan: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "member_change_request.create",
    entityType: "member_change_requests",
    entityId: targetId,
    before: null,
    after: { kind, target_label: targetLabel, reason },
    // Usulan belum mengubah apa pun; yang dicatat adalah pengajuannya.
    type: "auto",
  });

  revalidatePath("/od");
  revalidatePath("/tim");
  return { ok: true, message: `Usulan terkirim: ${summarizeProposal(kind, targetLabel, payload)}.` };
}

/**
 * Director memutuskan usulan OD. Menyetujui = menjalankan perubahannya sekarang juga
 * (jawaban #3: aksi Director langsung berlaku), lalu menandai usulan approved.
 */
export async function decideProposal(
  _prev: ProposalActionState,
  formData: FormData
): Promise<ProposalActionState> {
  const actor = await requirePermission("m11.manage_accounts");
  const id = Number(formData.get("request_id"));
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("decision_note") ?? "").trim() || null;
  if (!Number.isFinite(id)) return { ok: false, error: "Usulan tidak dikenali." };
  if (!["approved", "rejected"].includes(decision)) {
    return { ok: false, error: "Keputusan tidak dikenal." };
  }

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("member_change_requests")
    .select("id, kind, target_member_id, target_label, payload, status")
    .eq("id", id)
    .maybeSingle<{
      id: number;
      kind: ProposalKind;
      target_member_id: string | null;
      target_label: string;
      payload: Record<string, unknown>;
      status: string;
    }>();
  if (!request) return { ok: false, error: "Usulan tidak ditemukan." };
  if (request.status !== "pending") {
    return { ok: false, error: "Usulan ini sudah diputuskan sebelumnya." };
  }

  let outcome: MemberActionState = { ok: true };
  if (decision === "approved") {
    if (request.kind === "create") {
      const parsed = memberCreateSchema.safeParse(request.payload);
      if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
      outcome = await applyCreate(actor.id, parsed.data);
    } else if (!request.target_member_id) {
      return { ok: false, error: "Anggota tim yang diusulkan sudah tidak ada." };
    } else if (request.kind === "update") {
      const parsed = memberUpdateSchema.safeParse(request.payload);
      if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
      outcome = await applyUpdate(actor.id, request.target_member_id, parsed.data);
    } else if (request.kind === "deactivate") {
      outcome = await applyDeactivate(actor.id, request.target_member_id);
    } else {
      outcome = await applyDelete(actor.id, request.target_member_id);
    }
    // Perubahan gagal → usulan tetap pending supaya Director bisa mencoba lagi.
    if (!outcome?.ok) return { ok: false, error: outcome?.error };
  }

  const { error } = await admin
    .from("member_change_requests")
    .update({
      status: decision,
      decided_by: actor.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { ok: false, error: `Gagal menyimpan keputusan: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: `member_change_request.${decision}`,
    entityType: "member_change_requests",
    entityId: String(id),
    before: { status: "pending" },
    after: { status: decision, decision_note: note },
    type: "approval",
  });

  revalidatePath("/tim");
  revalidatePath("/od");
  return {
    ok: true,
    message:
      decision === "approved"
        ? `Usulan disetujui. ${outcome?.message ?? ""}`.trim()
        : "Usulan ditolak.",
    tempPassword: outcome?.tempPassword,
    tempPasswordEmail: outcome?.tempPasswordEmail,
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission, ROLES, type Role } from "@/lib/rbac";
import { parseSheet } from "@/lib/utils/sheet";
import { ROLE_TEAM_GROUP, SEGMENTS, TEAM_GROUPS } from "@/lib/tim/roles";
import { generateTempPassword } from "@/lib/utils/password";

/** Pesan error yang menyebut kolom + nilai yang ditolak, bukan sekadar daftar enum. */
function roleErrorMessage(value: string): string {
  if (!value) return `kolom 'role' kosong — wajib diisi (pilihan: ${ROLES.join(", ")})`;
  if (value === "cm") {
    return "role 'cm' tidak valid — 'cm' adalah nilai untuk kolom team_group. Untuk tim CM pakai 'cpm' (Creator Manager) atau 'cm_lead' (CM Lead)";
  }
  if ((TEAM_GROUPS as readonly string[]).includes(value)) {
    return `role '${value}' tidak valid — itu nilai untuk kolom team_group, bukan role (pilihan role: ${ROLES.join(", ")})`;
  }
  return `role '${value}' tidak dikenal (pilihan: ${ROLES.join(", ")})`;
}

function teamGroupErrorMessage(value: string): string {
  if (!value) {
    return "kolom 'team_group' kosong dan tidak bisa diturunkan otomatis karena role tidak valid";
  }
  return `team_group '${value}' tidak dikenal (pilihan: ${TEAM_GROUPS.join(", ")})`;
}

const memberRowSchema = z.object({
  name: z.string().min(1, "kolom 'name' kosong"),
  email: z.string().email("email tidak valid"),
  role: z.enum(ROLES, {
    errorMap: (_issue, ctx) => ({ message: roleErrorMessage(String(ctx.data ?? "")) }),
  }),
  team_group: z.enum(TEAM_GROUPS, {
    errorMap: (_issue, ctx) => ({ message: teamGroupErrorMessage(String(ctx.data ?? "")) }),
  }),
  platform_segment: z.enum(SEGMENTS).nullable(),
});

export interface UploadReport {
  inserted: number;
  skipped: { row: number; reason: string }[];
  /**
   * Pesan kegagalan yang boleh dibaca pengguna. Next.js menyensor pesan error
   * server action di production (hanya menyisakan digest), jadi action yang mau
   * menjelaskan kenapa upload gagal harus MENGEMBALIKAN pesannya, bukan throw.
   */
  error?: string;
  /**
   * Rincian hasil untuk ditampilkan sebagai ringkasan ("120 produk baru", "8 perlu
   * review", …). Opsional: upload yang tidak mengisinya tetap menampilkan jumlah
   * baris berhasil seperti biasa.
   */
  summary?: { label: string; value: string }[];
  /** Peringatan non-fatal (upload tetap berhasil), mis. kolom opsional tidak ditemukan. */
  warning?: string;
  /**
   * Password sementara akun baru — ditampilkan SEKALI di layar hasil upload (tidak
   * disimpan di sisi kita, hanya Supabase Auth yang punya hash-nya). Kosong untuk
   * baris yang emailnya sudah punya auth user sebelumnya (lihat fallback authError).
   */
  credentials?: { email: string; password: string }[];
}

/**
 * Bulk upload team_members from CSV (name,email,role,team_group[,platform_segment]).
 * Creates the auth user (invite-style, email confirmed) then the team_members row.
 * Management only (RBAC + RLS).
 */
export async function uploadTeamMembers(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("team.bulk_upload");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })), credentials: [] };
  const admin = createAdminClient();

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2; // header = line 1
    // Baris contoh kosong bawaan template (dan baris kosong di tengah sheet)
    // dilewati diam-diam — bukan error yang perlu diperbaiki user.
    if (Object.values(raw).every((v) => String(v ?? "").trim() === "")) continue;
    const role = raw.role?.trim().toLowerCase() ?? "";
    // team_group opsional: kalau kosong, turunkan dari role (satu role = satu divisi).
    const teamGroup =
      raw.team_group?.trim().toLowerCase() || ROLE_TEAM_GROUP[role as Role] || "";
    const parsed = memberRowSchema.safeParse({
      name: raw.name?.trim(),
      email: raw.email?.trim().toLowerCase(),
      role,
      team_group: teamGroup,
      platform_segment: raw.platform_segment?.trim().toLowerCase() || null,
    });
    if (!parsed.success) {
      report.skipped.push({ row: rowNum, reason: parsed.error.issues.map((iss) => iss.message).join("; ") });
      continue;
    }
    const row = parsed.data;

    const { data: existing } = await admin
      .from("team_members").select("id").eq("email", row.email).maybeSingle();
    if (existing) {
      report.skipped.push({ row: rowNum, reason: `${row.email} sudah terdaftar` });
      continue;
    }

    // team_members.id references auth.users(id) → ensure the auth user exists first.
    let userId: string;
    let tempPassword: string | undefined;
    const password = generateTempPassword();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: row.email,
      password,
      email_confirm: true,
    });
    if (authError) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const match = list?.users.find((u) => u.email?.toLowerCase() === row.email);
      if (!match) {
        report.skipped.push({ row: rowNum, reason: `gagal buat auth user: ${authError.message}` });
        continue;
      }
      // Auth user sudah ada sebelumnya (mis. bekas creator_user) — jangan timpa passwordnya.
      userId = match.id;
    } else {
      userId = created.user.id;
      tempPassword = password;
    }

    const { error: insertError } = await admin.from("team_members").insert({
      id: userId,
      name: row.name,
      email: row.email,
      role: row.role,
      team_group: row.team_group,
      platform_segment: row.platform_segment,
    });
    if (insertError) {
      report.skipped.push({ row: rowNum, reason: insertError.message });
      continue;
    }

    await writeAudit({
      actorId: actor.id,
      action: "team_member.bulk_insert",
      entityType: "team_members",
      entityId: userId,
      after: row,
      type: "auto",
    });
    if (tempPassword) report.credentials!.push({ email: row.email, password: tempPassword });
    report.inserted++;
  }

  revalidatePath("/tim");
  return report;
}

export interface TeamMemberActionState {
  ok: boolean;
  message: string;
}

export interface AddMemberResult extends TeamMemberActionState {
  /** Password sementara — ditampilkan SEKALI di layar hasil, tidak disimpan di sisi kita. */
  tempPassword?: string;
}

/**
 * Tambah satu akun anggota tim lewat form (bukan upload massal). Dibatasi
 * "team.add_single" (= MANAGEMENT_ROLES: director/head/spv) karena menambah
 * akun berarti memberi akses login baru ke sistem internal.
 */
export async function addTeamMember(formData: FormData): Promise<AddMemberResult> {
  const actor = await requirePermission("team.add_single");

  const roleRaw = String(formData.get("role") ?? "").trim().toLowerCase();
  const teamGroupRaw = String(formData.get("team_group") ?? "").trim().toLowerCase();
  const parsed = memberRowSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    role: roleRaw,
    team_group: teamGroupRaw || ROLE_TEAM_GROUP[roleRaw as Role] || "",
    platform_segment: String(formData.get("platform_segment") ?? "").trim().toLowerCase() || null,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((iss) => iss.message).join("; ") };
  }
  const row = parsed.data;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("team_members").select("id").eq("email", row.email).maybeSingle();
  if (existing) return { ok: false, message: `${row.email} sudah terdaftar` };

  const password = generateTempPassword();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: row.email,
    password,
    email_confirm: true,
  });
  if (authError) return { ok: false, message: `Gagal membuat akun login: ${authError.message}` };
  const userId = created.user.id;

  const { error: insertError } = await admin.from("team_members").insert({
    id: userId,
    name: row.name,
    email: row.email,
    role: row.role,
    team_group: row.team_group,
    platform_segment: row.platform_segment,
  });
  if (insertError) {
    // Auth user sudah terlanjur dibuat — hapus lagi supaya email ini bisa dicoba ulang.
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, message: insertError.message };
  }

  await writeAudit({
    actorId: actor.id,
    action: "team_member.add_single",
    entityType: "team_members",
    entityId: userId,
    after: row,
    type: "auto",
  });

  revalidatePath("/tim");
  return { ok: true, message: `${row.name} berhasil ditambahkan.`, tempPassword: password };
}

/**
 * Nonaktifkan/aktifkan akun — soft delete via `active` (bukan hard DELETE:
 * puluhan tabel mereferensikan team_members tanpa cascade, dan RLS 0002 sudah
 * menggerbang sesi lewat kolom ini, jadi menonaktifkan = mencabut akses
 * seketika). Trigger `guard_last_director` (migrasi 0010) menolak menonaktifkan
 * Director aktif terakhir — errornya dikembalikan sebagai pesan, bukan throw
 * (Next.js menyensor Error mentah di production, lihat projects/actions.ts).
 */
export async function setTeamMemberActive(formData: FormData): Promise<TeamMemberActionState> {
  const actor = await requirePermission("team.deactivate");
  const memberId = String(formData.get("member_id") ?? "").trim();
  const active = formData.get("active") === "true";
  if (!memberId) return { ok: false, message: "Anggota tim tidak valid" };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("team_members").select("name, active").eq("id", memberId).maybeSingle();
  if (!before) return { ok: false, message: "Anggota tim tidak ditemukan" };
  if (before.active === active) {
    return { ok: true, message: `${before.name} sudah ${active ? "aktif" : "nonaktif"}.` };
  }

  const { error } = await admin.from("team_members").update({ active }).eq("id", memberId);
  if (error) {
    return { ok: false, message: `Gagal ${active ? "mengaktifkan" : "menonaktifkan"} ${before.name}: ${error.message}` };
  }

  await writeAudit({
    actorId: actor.id,
    action: active ? "team_member.activate" : "team_member.deactivate",
    entityType: "team_members",
    entityId: memberId,
    before: { active: before.active },
    after: { active },
    type: "auto",
  });

  revalidatePath("/tim");
  return { ok: true, message: `${before.name} berhasil di${active ? "aktifkan" : "nonaktifkan"}.` };
}

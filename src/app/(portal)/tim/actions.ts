"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission, ROLES, type Role } from "@/lib/rbac";
import { parseSheet } from "@/lib/utils/sheet";
import { ROLE_TEAM_GROUP, SEGMENTS, TEAM_GROUPS } from "@/lib/tim/roles";

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
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
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
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: row.email,
      email_confirm: true,
    });
    if (authError) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const match = list?.users.find((u) => u.email?.toLowerCase() === row.email);
      if (!match) {
        report.skipped.push({ row: rowNum, reason: `gagal buat auth user: ${authError.message}` });
        continue;
      }
      userId = match.id;
    } else {
      userId = created.user.id;
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
    report.inserted++;
  }

  revalidatePath("/tim");
  return report;
}

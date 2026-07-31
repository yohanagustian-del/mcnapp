import { z } from "zod";
import {
  ROLES,
  ROLE_TEAM_GROUP,
  ROLE_LABELS,
  SEGMENTS,
  TEAM_GROUPS,
  type Role,
  type TeamGroup,
} from "./roles";

/**
 * Aturan murni untuk manajemen user tim (tambah / ganti jabatan / nonaktif / hapus permanen).
 * Bebas dari Supabase, Next, dan Node API supaya bisa diuji langsung DAN dipakai komponen
 * klien (form usulan OD) — server action hanya memanggil helper di sini lalu menulis ke DB +
 * audit_logs. Generator password sementara ada di ./temp-password (server-only, node:crypto).
 */

/**
 * Field yang boleh diubah lewat form.
 *
 * `email` SENGAJA TIDAK ADA di sini: email adalah identitas login (team_members.id =
 * auth.users.id, dijoin lewat email saat seed). Menggantinya berarti mengganti akun auth,
 * jadi jalur yang benar adalah nonaktifkan akun lama + buat akun baru.
 */
export const EDITABLE_FIELDS = ["name", "role", "team_group", "platform_segment", "active"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABELS: Record<EditableField | "email", string> = {
  name: "Nama",
  role: "Jabatan",
  team_group: "Divisi",
  platform_segment: "Segmen Platform",
  active: "Status Aktif",
  email: "Email",
};

const nameSchema = z
  .string()
  .trim()
  .min(2, "Nama minimal 2 karakter")
  .max(120, "Nama maksimal 120 karakter");

const roleSchema = z.enum(ROLES, {
  errorMap: () => ({ message: "Jabatan tidak dikenal" }),
});

const teamGroupSchema = z.enum(TEAM_GROUPS, {
  errorMap: () => ({ message: "Divisi tidak dikenal" }),
});

const segmentSchema = z.enum(SEGMENTS, {
  errorMap: () => ({ message: "Segmen platform tidak dikenal" }),
});

/** Payload tambah user baru. Email hanya divalidasi di sini (dan tidak pernah bisa diubah lagi). */
export const memberCreateSchema = z.object({
  name: nameSchema,
  email: z.string().trim().toLowerCase().email("Format email tidak valid"),
  role: roleSchema,
  team_group: teamGroupSchema,
  platform_segment: segmentSchema.nullable(),
});
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

/** Payload edit user (ganti jabatan / divisi / segmen / nama / status). */
export const memberUpdateSchema = z.object({
  name: nameSchema,
  role: roleSchema,
  team_group: teamGroupSchema,
  platform_segment: segmentSchema.nullable(),
  active: z.boolean(),
});
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

/**
 * Membaca field user dari FormData ke bentuk mentah yang siap divalidasi.
 * `team_group` kosong diturunkan otomatis dari role (satu role = satu divisi),
 * konsisten dengan parser bulk upload CSV.
 */
export function readMemberFields(form: {
  get(name: string): FormDataEntryValue | null;
}): Record<string, unknown> {
  const role = String(form.get("role") ?? "").trim().toLowerCase();
  const rawGroup = String(form.get("team_group") ?? "").trim().toLowerCase();
  const segment = String(form.get("platform_segment") ?? "").trim().toLowerCase();
  return {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    role,
    team_group: rawGroup || ROLE_TEAM_GROUP[role as Role] || "",
    platform_segment: segment === "" ? null : segment,
    active: String(form.get("active") ?? "true") === "true",
  };
}

/** Pesan error gabungan dari zod → satu kalimat Bahasa Indonesia. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = String(issue.path[0] ?? "");
      const label = FIELD_LABELS[field as EditableField | "email"] ?? field;
      return `${label}: ${issue.message}`;
    })
    .join("; ");
}

/** Nilai satu field untuk ditampilkan di ringkasan perubahan. */
function displayValue(field: EditableField, value: unknown): string {
  if (field === "role") return ROLE_LABELS[value as Role] ?? String(value);
  if (field === "active") return value ? "Aktif" : "Nonaktif";
  if (value === null || value === "") return "—";
  return String(value);
}

export interface FieldChange {
  field: EditableField;
  label: string;
  from: string;
  to: string;
}

/**
 * Perbandingan sebelum→sesudah untuk field yang boleh diedit.
 * Dipakai untuk audit_logs, ringkasan konfirmasi, dan isi usulan OD —
 * satu implementasi supaya ketiganya tidak pernah beda.
 */
export function diffMember(
  before: Partial<Record<EditableField, unknown>>,
  after: Partial<Record<EditableField, unknown>>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in after)) continue;
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (from === to) continue;
    changes.push({
      field,
      label: FIELD_LABELS[field],
      from: displayValue(field, from),
      to: displayValue(field, to),
    });
  }
  return changes;
}

/**
 * FK NOT NULL yang menunjuk team_members. Baris di tabel ini WAJIB punya pelaku,
 * jadi Postgres menolak hapus permanen selama masih ada — dan memaksanya berarti
 * ikut menghapus catatan bisnis, yang tidak pernah dilakukan diam-diam.
 *
 * Sisa FK lain (40 kolom) sudah ON DELETE SET NULL, dan tool_usage_logs.member_id —
 * satu-satunya FK NOT NULL yang BUKAN catatan bisnis (telemetri page-view) — CASCADE.
 * Lihat migrasi 0028. Daftar ini diverifikasi langsung terhadap pg_constraint.
 */
export const BLOCKING_REFERENCES = [
  {
    table: "metric_upload_batches",
    column: "uploaded_by",
    label: "riwayat upload data platform",
  },
  {
    table: "live_schedule_slots",
    column: "created_by",
    label: "slot jadwal live yang dibuat",
  },
  {
    table: "project_manpower",
    column: "member_id",
    label: "penugasan man power di Special Project",
  },
] as const;

export interface BlockingCount {
  label: string;
  count: number;
}

/**
 * Pesan penolakan hapus permanen: menyebut PERSIS data apa yang menghalangi
 * (bukan sekadar "gagal karena constraint"), lalu mengarahkan ke nonaktifkan.
 */
export function formatBlockingMessage(name: string, counts: BlockingCount[]): string {
  const blocking = counts.filter((c) => c.count > 0);
  if (blocking.length === 0) return "";
  const detail = blocking.map((c) => `${c.count} ${c.label}`).join(" dan ");
  return (
    `${name} tidak bisa dihapus permanen karena masih terhubung ke ${detail}. ` +
    `Data itu catatan bisnis yang wajib punya pelaku, jadi tidak ikut dihapus. ` +
    `Gunakan "Nonaktifkan" — akunnya tidak bisa login lagi dan riwayatnya tetap utuh.`
  );
}

/** Pesan cadangan kalau FK yang menghalangi ternyata di luar BLOCKING_REFERENCES. */
export function formatForeignKeyError(name: string, dbMessage: string): string {
  return (
    `${name} tidak bisa dihapus permanen karena masih ada data lain yang menunjuk akun ini ` +
    `(${dbMessage}). Gunakan "Nonaktifkan" supaya riwayatnya tetap utuh.`
  );
}

/** Jenis usulan OD. */
export const PROPOSAL_KINDS = ["create", "update", "deactivate", "delete"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  create: "Tambah user baru",
  update: "Ganti jabatan / data",
  deactivate: "Nonaktifkan user",
  delete: "Hapus permanen",
};

export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu Director",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Batal",
};

/**
 * Ringkasan satu baris untuk daftar usulan. `payload` untuk kind=create berisi
 * field user baru; untuk kind=update berisi field yang diusulkan berubah.
 */
export function summarizeProposal(
  kind: ProposalKind,
  targetLabel: string,
  payload: Record<string, unknown>
): string {
  if (kind === "create") {
    const role = ROLE_LABELS[payload.role as Role] ?? String(payload.role ?? "—");
    return `Tambah ${payload.name ?? "—"} (${payload.email ?? "—"}) sebagai ${role}`;
  }
  if (kind === "update") {
    const changes = EDITABLE_FIELDS.filter((f) => f in payload).map(
      (f) => `${FIELD_LABELS[f]} → ${displayValue(f, payload[f])}`
    );
    return changes.length > 0
      ? `${targetLabel}: ${changes.join(", ")}`
      : `${targetLabel}: tidak ada perubahan`;
  }
  if (kind === "deactivate") return `Nonaktifkan ${targetLabel}`;
  return `Hapus permanen ${targetLabel}`;
}

/** Label snapshot yang disimpan di usulan supaya riwayat tetap terbaca setelah user dihapus. */
export function memberLabel(member: { name: string; email: string }): string {
  return `${member.name} (${member.email})`;
}

export type { Role, TeamGroup };

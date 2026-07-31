"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission, CM_ROLES, MANAGEMENT_ROLES } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { parseSheet } from "@/lib/utils/sheet";
import {
  buildImportRows,
  insertStatus,
  summarize,
  IMPORT_COLUMNS,
  SHEET_REQUIRED_HEADERS,
  type ImportContext,
  type ImportSummary,
  type ParsedImportRow,
} from "@/lib/creators/import-spec";
import { buildCreatorTemplate, TEMPLATE_FILENAME } from "@/lib/creators/import-template";

/** Role yang boleh muncul sebagai CM di kolom CM* (owner_cpm_id). */
const CM_OWNER_ROLES = [...CM_ROLES, ...MANAGEMENT_ROLES];

/** Muat konteks pencocokan: daftar CM + kreator yang sudah ada (by username). */
async function loadContext(): Promise<ImportContext & { cmNames: string[] }> {
  const admin = createAdminClient();

  const { data: members, error: memberError } = await admin
    .from("team_members")
    .select("id, name, role, active")
    .in("role", CM_OWNER_ROLES)
    .eq("active", true);
  if (memberError) throw new Error(`Gagal memuat daftar CM: ${memberError.message}`);

  const cmByName = new Map<string, { id: string; name: string }>();
  for (const m of members ?? []) {
    if (m.name) cmByName.set(String(m.name).toLowerCase(), { id: m.id, name: m.name });
  }

  // Paginated: PostgREST caps one select at 1000 rows and ignores a larger
  // .limit(), so a bare select would hide every creator past row 1000 — the
  // import would then classify an existing username as "baru" and fail on the
  // unique index instead of updating its CM.
  const creators = await fetchAll<{ id: string; username: string | null; owner_cpm_id: string | null }>(
    admin, "creators", "id, username, owner_cpm_id", (q) => q.not("username", "is", null)
  );

  // owner_cpm_id → nama, supaya preview bisa menampilkan "CM lama → CM baru".
  const nameById = new Map<string, string>();
  for (const [, cm] of cmByName) nameById.set(cm.id, cm.name);

  const existingByUsername = new Map<string, { id: string; cmName: string | null }>();
  for (const c of creators) {
    const key = String(c.username).trim().toLowerCase();
    if (!key) continue;
    existingByUsername.set(key, {
      id: c.id,
      cmName: c.owner_cpm_id ? nameById.get(c.owner_cpm_id) ?? "—" : null,
    });
  }

  return {
    cmByName,
    existingByUsername,
    cmNames: [...cmByName.values()].map((c) => c.name).sort((a, b) => a.localeCompare(b, "id")),
  };
}

/**
 * Generate file template .xlsx. Dikembalikan sebagai base64 supaya bisa
 * melewati batas server action (mengikuti pola DownloadCsvButton yang
 * mengalirkan hasil server action ke unduhan browser).
 */
export async function downloadCreatorTemplate(): Promise<{ filename: string; base64: string }> {
  await requirePermission("creators.bulk_upload");
  const { cmNames } = await loadContext();
  const buffer = buildCreatorTemplate(cmNames);
  return {
    filename: TEMPLATE_FILENAME,
    base64: Buffer.from(buffer).toString("base64"),
  };
}

export interface ImportPreview {
  rows: ParsedImportRow[];
  summary: ImportSummary;
  /** Baris mentah dari file — dikirim balik saat commit untuk divalidasi ulang di server. */
  rawRows: Record<string, string>[];
  /** Judul kolom preview, urut sesuai template. */
  columns: string[];
}

/**
 * Baca file yang diunggah dan klasifikasikan tiap baris (insert / update / error)
 * TANPA menulis apa pun. Hasilnya ditampilkan sebagai preview untuk dikonfirmasi user.
 */
export async function previewCreatorImport(formData: FormData): Promise<ImportPreview> {
  await requirePermission("creators.bulk_upload");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("File Excel (.xlsx) atau CSV wajib dipilih");
  }

  const { rows, errors } = await parseSheet(file, SHEET_REQUIRED_HEADERS);
  if (errors.length > 0) {
    throw new Error(
      `${errors.join("; ")} — pastikan file memakai template (kolom Username* dan CM*)`
    );
  }
  if (rows.length === 0) throw new Error("File tidak berisi data — pakai template dan isi mulai baris ke-2");

  const ctx = await loadContext();
  if (ctx.cmByName.size === 0) {
    throw new Error("Belum ada CM aktif di tabel Tim — daftarkan CM dulu sebelum import kreator");
  }

  const parsed = buildImportRows(rows, ctx);
  return {
    rows: parsed,
    summary: summarize(parsed),
    rawRows: rows,
    columns: IMPORT_COLUMNS.map((c) => c.label),
  };
}

export interface CommitReport {
  inserted: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}

/**
 * Simpan hasil import. Baris mentah dari preview divalidasi ULANG di server
 * (konteks CM + kreator dimuat lagi) — klien tidak bisa menyuntik payload
 * sembarangan, dan data yang berubah antara preview dan konfirmasi tetap terdeteksi.
 *
 * Upsert by username: sudah ada → UPDATE (owner_cpm_id di-REPLACE dengan CM di
 * file), belum ada → INSERT. Baris error tidak pernah ditulis.
 */
export async function commitCreatorImport(rawRows: Record<string, string>[]): Promise<CommitReport> {
  const actor = await requirePermission("creators.bulk_upload");
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error("Tidak ada data untuk disimpan — unggah file dulu");
  }

  const ctx = await loadContext();
  const parsed = buildImportRows(rawRows, ctx);
  const admin = createAdminClient();

  const report: CommitReport = { inserted: 0, updated: 0, skipped: [] };

  for (const row of parsed) {
    if (row.status === "error") {
      report.skipped.push({ row: row.rowNum, reason: row.errors.join("; ") });
      continue;
    }

    if (row.existingId) {
      const { error } = await admin.from("creators").update(row.payload).eq("id", row.existingId);
      if (error) {
        report.skipped.push({ row: row.rowNum, reason: error.message });
        continue;
      }
      await writeAudit({
        actorId: actor.id,
        action: "creator.import_update",
        entityType: "creators",
        entityId: row.existingId,
        before: { owner_cpm_id_name: row.previousCmName },
        after: row.payload,
        type: "auto",
      });
      report.updated++;
      continue;
    }

    // Insert baru; retry pada tabrakan id CRT- yang langka (pola sama dengan uploadCreators).
    let insertedId: string | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !insertedId; attempt++) {
      const id = genId("CRT");
      const { error } = await admin.from("creators").insert({
        id,
        ...row.payload,
        // name NOT NULL di DB — kreator baru tanpa "Nama Creator" memakai username.
        name: row.payload.name ?? row.username,
        status: insertStatus(row.values),
      });
      if (!error) {
        insertedId = id;
      } else if (error.code === "23505") {
        lastError = error.message; // id collision → coba id baru
      } else {
        lastError = error.message;
        break;
      }
    }

    if (!insertedId) {
      report.skipped.push({ row: row.rowNum, reason: lastError });
      continue;
    }

    await writeAudit({
      actorId: actor.id,
      action: "creator.import_insert",
      entityType: "creators",
      entityId: insertedId,
      after: row.payload,
      type: "auto",
    });
    report.inserted++;
  }

  revalidatePath("/creators");
  return report;
}

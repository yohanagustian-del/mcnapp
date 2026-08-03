"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission, CM_ROLES, MANAGEMENT_ROLES } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { buildMasterCreatorRow, MANUAL_FIELDS } from "@/lib/creators/master-upload";

/** Role yang boleh muncul sebagai CM (owner_cpm_id) — sama dengan jalur import. */
const CM_OWNER_ROLES = [...CM_ROLES, ...MANAGEMENT_ROLES];

/** Ringkasan kreator yang sudah memakai username yang diinput. */
export interface ExistingCreator {
  id: string;
  name: string;
  username: string;
  cmName: string | null;
  status: string;
  platform: string | null;
  joinDate: string | null;
}

export type CreateCreatorResult =
  | { status: "idle" }
  | { status: "created"; message: string; creatorId: string }
  | { status: "updated"; message: string; creatorId: string }
  /** Username sudah dipakai — UI menawarkan timpa / batal, dengan data pembanding. */
  | { status: "duplicate"; message: string; existing: ExistingCreator }
  | { status: "error"; message: string };

/**
 * Tambah kreator manual dari tab Kreator (tombol "Tambah Kreator").
 *
 * Username & CM WAJIB; sisanya opsional. Payload dibangun lewat
 * `buildMasterCreatorRow` yang sama dengan import Excel — form ini pada dasarnya
 * "import satu baris", jadi aturan parsing (Rupiah, tanggal bebas, level 1-8,
 * kelas kreator, status default `aktif`) tidak boleh punya salinan kedua yang
 * bisa hanyut (CLAUDE.md #4).
 *
 * Username sudah ada → TIDAK langsung ditimpa. Action mengembalikan status
 * "duplicate" beserta data kreator lama supaya user bisa membandingkan dulu;
 * penimpaan hanya terjadi kalau user mengirim ulang dengan `overwrite=1`.
 * `commission_share` tidak pernah bisa diisi dari sini — read-only, sync
 * platform (CLAUDE.md #3).
 */
export async function createCreatorManual(
  _prev: CreateCreatorResult,
  formData: FormData
): Promise<CreateCreatorResult> {
  try {
    const actor = await requirePermission("creators.bulk_upload");
    const admin = createAdminClient();

    // Nama field form = kunci header sheet yang sudah dinormalisasi, supaya bisa
    // langsung disuap ke parser import.
    const row: Record<string, string> = {};
    for (const field of MANUAL_FIELDS) {
      row[field] = String(formData.get(field) ?? "").trim();
    }
    const overwrite = String(formData.get("overwrite") ?? "") === "1";

    const username = row.username;
    if (!username) return { status: "error", message: "Username wajib diisi." };

    // CM wajib di form manual (di import massal boleh kosong) — kreator baru tanpa
    // CM langsung jatuh ke daftar "Kreator belum punya CM".
    const cmId = String(formData.get("owner_cpm_id") ?? "").trim();
    if (!cmId) return { status: "error", message: "CM wajib dipilih." };
    const { data: cm } = await admin
      .from("team_members")
      .select("id, name, role, active")
      .eq("id", cmId)
      .maybeSingle();
    if (!cm || !cm.active || !CM_OWNER_ROLES.includes(cm.role)) {
      return { status: "error", message: "CM yang dipilih tidak aktif / tidak valid." };
    }
    row.cm = cm.name;

    const outcome = buildMasterCreatorRow(row, new Map([[cm.name.toLowerCase(), cm.id]]));
    if (outcome.kind !== "row") {
      return {
        status: "error",
        message: outcome.kind === "skip" ? outcome.reason : "Form kosong — isi minimal username & CM.",
      };
    }

    // Cocokkan username case-insensitive: "Winris12" dan "winris12" adalah akun
    // yang sama di platform, jadi tidak boleh jadi dua baris kreator.
    //
    // `_` dan `%` adalah wildcard LIKE dan lazim ada di username ("yr_ofc"), jadi
    // pola-nya di-escape dulu; hasilnya tetap diverifikasi dengan perbandingan
    // string biasa supaya tidak ada kecocokan semu.
    const likePattern = username.replace(/([\\%_])/g, "\\$1");
    const { data: existingRows, error: findError } = await admin
      .from("creators")
      .select("id, name, username, status, platform, join_date, owner_cpm_id, team_members(name)")
      .ilike("username", likePattern)
      .limit(5);
    if (findError) return { status: "error", message: `Gagal memeriksa username: ${findError.message}` };
    const found = (existingRows ?? []).find(
      (r) => String(r.username ?? "").toLowerCase() === username.toLowerCase()
    );

    if (found && !overwrite) {
      return {
        status: "duplicate",
        message: `Username "${found.username}" sudah terdaftar.`,
        existing: {
          id: found.id,
          name: found.name,
          username: found.username ?? username,
          cmName: (found.team_members as { name?: string } | null)?.name ?? null,
          status: found.status,
          platform: found.platform ?? null,
          joinDate: found.join_date ?? null,
        },
      };
    }

    if (found) {
      // Timpa = perbarui kolom yang DIISI saja. Kolom yang dikosongkan di form
      // tidak menghapus data lama — aturan yang sama dengan import.
      const { error } = await admin.from("creators").update(outcome.payload).eq("id", found.id);
      if (error) return { status: "error", message: `Gagal menimpa: ${error.message}` };
      await writeAudit({
        actorId: actor.id,
        action: "creator.manual_overwrite",
        entityType: "creators",
        entityId: found.id,
        before: { name: found.name, username: found.username, owner_cpm_id: found.owner_cpm_id },
        after: outcome.payload,
        type: "auto",
      });
      revalidatePath("/creators");
      return {
        status: "updated",
        message: `Data ${found.username} diperbarui (kolom yang dikosongkan tidak diubah).`,
        creatorId: found.id,
      };
    }

    // Insert baru; retry pada tabrakan id CRT- yang langka (pola sama dengan import).
    let insertedId: string | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !insertedId; attempt++) {
      const id = genId("CRT");
      const { error } = await admin.from("creators").insert({
        id,
        ...outcome.payload,
        name: outcome.payload.name ?? outcome.username,
        status: outcome.insertStatus,
      });
      if (!error) insertedId = id;
      else if (error.code === "23505") lastError = error.message; // id bentrok → id baru
      else {
        lastError = error.message;
        break;
      }
    }
    if (!insertedId) return { status: "error", message: `Gagal menyimpan: ${lastError}` };

    await writeAudit({
      actorId: actor.id,
      action: "creator.manual_insert",
      entityType: "creators",
      entityId: insertedId,
      after: { ...outcome.payload, status: outcome.insertStatus },
      type: "auto",
    });
    revalidatePath("/creators");
    return {
      status: "created",
      message: `Kreator ${outcome.username} ditambahkan (${insertedId}, status ${outcome.insertStatus}).`,
      creatorId: insertedId,
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Gagal menambah kreator." };
  }
}

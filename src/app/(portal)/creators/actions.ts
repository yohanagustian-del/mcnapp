"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission, CM_ROLES, MANAGEMENT_ROLES } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { buildMasterCreatorRow, STATUSES } from "@/lib/creators/master-upload";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { UploadReport } from "@/app/(portal)/tim/actions";

/** Role yang boleh muncul sebagai CM di kolom "CM" (owner_cpm_id) — sama dengan Import Kreator. */
const CM_OWNER_ROLES = [...CM_ROLES, ...MANAGEMENT_ROLES];

/**
 * Ingest master sheet "data creator" (format asli, header Indonesia) ATAU
 * template Import Kreator (Username*, CM*, …). Match by Username (lalu Nama) →
 * UPDATE; belum ada → INSERT (id CRT- dari util terpusat). GMV total/live/video
 * di master TIDAK dioverwrite dari sheet bila kosong — sumbernya upload data
 * platform (/metrics). commission_share TIDAK diterima dari sheet mana pun —
 * hanya sync platform (read-only, CLAUDE.md #3).
 *
 * Username = kunci baris, bukan Nama Creator: nama tampilan berubah-ubah dan
 * sering dikosongkan di sheet, sedangkan username itu identitas akun. Baris
 * tanpa username DILEWATI (tidak bisa dicocokkan / dijadikan kunci); baris tanpa
 * Nama Creator tetap masuk dengan nama = username.
 */
export async function uploadCreators(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("creators.bulk_upload");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  const admin = createAdminClient();

  // Kolom "CM" berisi NAMA — di-resolve ke team_members.id (creators.owner_cpm_id).
  const { data: members, error: memberError } = await admin
    .from("team_members")
    .select("id, name")
    .in("role", CM_OWNER_ROLES)
    .eq("active", true);
  if (memberError) throw new Error(`Gagal memuat daftar CM: ${memberError.message}`);
  const cmByName = new Map<string, string>();
  for (const m of members ?? []) if (m.name) cmByName.set(String(m.name).trim().toLowerCase(), m.id);

  // Existing creators for upsert matching (username first, then display name).
  // Paginated: PostgREST caps one select at 1000 rows and ignores a larger
  // .limit(), so a bare select would hide every creator past row 1000 and turn
  // an UPDATE into a duplicate-key INSERT.
  const existing = await fetchAll<{ id: string; name: string | null; username: string | null }>(
    admin, "creators", "id, name, username", (q) => q
  );
  const byKey = new Map<string, string>();
  for (const c of existing) {
    if (c.username) byKey.set(String(c.username).toLowerCase(), c.id);
    if (c.name) byKey.set(String(c.name).toLowerCase(), c.id);
  }
  /** Kreator yang sudah dipakai baris lain di upload ini — lihat fallback nama di bawah. */
  const consumed = new Set<string>();

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;

    const outcome = buildMasterCreatorRow(raw, cmByName);
    // Baris kosong (baris contoh template / baris sela) dilewati diam-diam —
    // bukan kesalahan yang perlu diperbaiki user.
    if (outcome.kind === "empty") continue;
    if (outcome.kind === "skip") {
      report.skipped.push({ row: rowNum, reason: outcome.reason });
      continue;
    }
    // Catatan "perlu review" (mis. nama CM salah ketik): barisnya TETAP disimpan.
    if (outcome.note) report.skipped.push({ row: rowNum, reason: outcome.note });

    const { username, name, payload } = outcome;

    // Cocokkan by username dulu; fallback ke nama tampilan supaya kreator yang
    // sudah pernah masuk tanpa username (sheet lama) di-UPDATE, bukan diduplikasi.
    //
    // Fallback nama hanya boleh mengenai kreator yang BELUM dipakai baris lain di
    // upload ini: nama tampilan tidak unik (satu sheet bisa punya beberapa
    // "Evelyn" dengan username berbeda), dan tanpa penjagaan ini semuanya akan
    // menimpa satu baris yang sama — beberapa kreator hilang tanpa jejak.
    const matchKey = username.toLowerCase();
    const byName = byKey.get(name.toLowerCase());
    const existingId =
      byKey.get(matchKey) ?? (byName && !consumed.has(byName) ? byName : undefined);

    if (existingId) {
      const { error } = await admin.from("creators").update(payload).eq("id", existingId);
      if (error) {
        report.skipped.push({ row: rowNum, reason: error.message });
        continue;
      }
      await writeAudit({
        actorId: actor.id, action: "creator.master_update", entityType: "creators",
        entityId: existingId, after: payload, type: "auto",
      });
      // Baris berikutnya dengan username yang sama kini ikut mengarah ke id ini
      // (sebelum update, kreator itu mungkin hanya terdaftar lewat nama).
      byKey.set(matchKey, existingId);
      consumed.add(existingId);
      report.inserted++;
      continue;
    }

    // Insert baru; retry pada tabrakan id CRT- yang langka.
    let inserted = false;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const id = genId("CRT");
      const { error } = await admin.from("creators").insert({
        id,
        status: outcome.insertStatus,
        ...payload,
      });
      if (!error) {
        inserted = true;
        byKey.set(matchKey, id);
        byKey.set(name.toLowerCase(), id);
        consumed.add(id);
        await writeAudit({
          actorId: actor.id, action: "creator.bulk_insert", entityType: "creators",
          entityId: id, after: payload, type: "auto",
        });
      } else if (error.code === "23505") {
        lastError = error.message; // id collision → retry with a new id
      } else {
        lastError = error.message;
        break;
      }
    }
    if (inserted) report.inserted++;
    else report.skipped.push({ row: rowNum, reason: lastError });
  }

  revalidatePath("/creators");
  return report;
}

/** State untuk form edit inline (useActionState). */
export type CreatorEditState = { ok: boolean; error?: string };

/**
 * Edit master data kreator per-row oleh Creator Manager (CLAUDE.md: creator suka
 * ganti username, no HP berubah, dll). Field editable: name, username, phone,
 * rc_live, rc_video, rate_card, level, domisili, uid, status.
 *
 * commission_share SENGAJA tidak termasuk — read-only sync platform (CLAUDE.md #3):
 * turun = alert, bukan edit. Diproteksi juga oleh trigger DB protect_commission_share.
 *
 * Setiap perubahan dicatat ke audit_logs (type: auto) dengan diff before/after,
 * hanya field yang benar-benar berubah.
 */
export async function updateCreatorProfile(
  _prev: CreatorEditState | null,
  formData: FormData
): Promise<CreatorEditState> {
  const actor = await requirePermission("creators.edit");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  if (!creatorId) return { ok: false, error: "creator_id wajib" };

  // Normalisasi helper: string kosong → null (agar UPDATE tidak menyimpan "").
  const text = (key: string): string | null => {
    const v = String(formData.get(key) ?? "").trim();
    return v || null;
  };

  const name = text("name");
  if (!name) return { ok: false, error: "Nama Creator wajib diisi" };

  // Level: kosong → null; selain itu harus 1..6.
  const levelRaw = String(formData.get("level") ?? "").trim();
  let level: number | null = null;
  if (levelRaw) {
    const n = Number(levelRaw);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      return { ok: false, error: "Level harus angka 1–8 (atau kosong)" };
    }
    level = n;
  }

  const statusRaw = String(formData.get("status") ?? "").trim().toLowerCase();
  if (!STATUSES.includes(statusRaw as (typeof STATUSES)[number])) {
    return { ok: false, error: `Status tidak valid: ${statusRaw || "(kosong)"}` };
  }

  const payload = {
    name,
    username: text("username"),
    phone: text("phone"),
    rc_live: text("rc_live"),
    rc_video: text("rc_video"),
    rate_card: parseRupiah(String(formData.get("rate_card") ?? "")),
    level,
    domisili: text("domisili"),
    uid: text("uid"),
    status: statusRaw,
  } as const;

  const admin = createAdminClient();
  const editableCols = Object.keys(payload).join(", ");
  const { data: before } = await admin
    .from("creators")
    .select(editableCols)
    .eq("id", creatorId)
    .maybeSingle<Record<string, unknown>>();
  if (!before) return { ok: false, error: `Creator ${creatorId} tidak ditemukan` };

  // Hanya catat field yang berubah agar audit log bermakna. Numeric (rate_card)
  // bisa kembali sebagai string dari Postgres — bandingkan lewat normalisasi
  // string supaya tidak salah deteksi "berubah".
  const norm = (x: unknown): string | null => (x == null ? null : String(x));
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (norm(before[k]) !== norm(v)) {
      beforeDiff[k] = before[k] ?? null;
      afterDiff[k] = v ?? null;
    }
  }

  if (Object.keys(afterDiff).length === 0) return { ok: true };

  const { error } = await admin.from("creators").update(payload).eq("id", creatorId);
  if (error) return { ok: false, error: `Gagal menyimpan: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "creator.profile_update",
    entityType: "creators",
    entityId: creatorId,
    before: beforeDiff,
    after: afterDiff,
    type: "auto",
  });
  revalidatePath("/creators");
  return { ok: true };
}

/** Rate card diisi manual per creator (QA feedback). Kosong = belum ada. */
export async function updateRateCard(formData: FormData): Promise<void> {
  const actor = await requirePermission("creators.bulk_upload");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  if (!creatorId) throw new Error("creator_id wajib");
  const rateCard = parseRupiah(String(formData.get("rate_card") ?? ""));

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("creators").select("rate_card").eq("id", creatorId).maybeSingle();
  if (!before) throw new Error(`Creator ${creatorId} tidak ditemukan`);

  const { error } = await admin
    .from("creators").update({ rate_card: rateCard }).eq("id", creatorId);
  if (error) throw new Error(`Gagal update rate card: ${error.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "creator.rate_card_update",
    entityType: "creators",
    entityId: creatorId,
    before: { rate_card: before.rate_card },
    after: { rate_card: rateCard },
    type: "auto",
  });
  revalidatePath("/creators");
}

"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";
import { parseCount, pick, pickPrefix } from "@/lib/platform-csv";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { UploadReport } from "@/app/(portal)/tim/actions";

const SEGMENTS = ["tc", "incubation", "celeb"] as const;
const STATUSES = ["prospek", "binding", "aktif", "nonaktif"] as const;

const PLATFORMS = ["tiktok", "shopee"] as const;

/** "beauty; skincare, fashion" → top-3 level-2 categories. */
function parseNiches(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const parts = raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, 3) : null;
}

/** "Lv 0" / "Lv 3" / "3" → level int 1..8 (0 / kosong / tak valid → null). */
function parseLevel(raw: string): number | null {
  const m = raw.match(/(\d)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 8 ? n : null;
}

/**
 * Ingest master sheet "data creator" (format asli, header Indonesia) ATAU
 * template lama (name,niche,...). Match by Username (lalu Nama) → UPDATE;
 * belum ada → INSERT (id CRT- dari util terpusat). GMV total/live/video di
 * master TIDAK dioverwrite dari sheet bila kosong — sumbernya upload data
 * platform (/metrics). commission_share TIDAK diterima dari sheet mana pun —
 * hanya sync platform (read-only, CLAUDE.md #3).
 */
export async function uploadCreators(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("creators.bulk_upload");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  const admin = createAdminClient();

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

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;

    const username = pick(raw, ["username"]);
    const name = pick(raw, ["nama_creator", "name"]) || username;
    if (!name) {
      report.skipped.push({ row: rowNum, reason: "Username / Nama Creator kosong" });
      continue;
    }

    const nicheRaw =
      pickPrefix(raw, ["niche_(", "niche"]) || pick(raw, ["niches", "top_niches"]);
    const topNiches = parseNiches(nicheRaw);
    const platformRaw = pick(raw, ["platform"]).toLowerCase();
    const segmentRaw = pick(raw, ["segment"]).toLowerCase();
    const statusRaw = pick(raw, ["status"]).toLowerCase();

    const gmv = parseRupiah(pick(raw, ["total_gmv", "gmv"]));
    const gmvLive = parseRupiah(pick(raw, ["gmv_live"]));
    const gmvVideo = parseRupiah(pick(raw, ["gmv_video"]));

    const payload: Record<string, unknown> = {
      name,
      username: username || null,
      profile_link: pick(raw, ["link_akun", "link_profile", "profile_link"]) || null,
      phone: pick(raw, ["no_hp", "phone"]) || null,
      tim_akuisisi: pick(raw, ["tim_akuisisi"]) || null,
      uid: pick(raw, ["uid"]) || null,
      followers: pick(raw, ["followers", "follower_tier"]) || null,
      content_quality: pick(raw, ["kualitas_konten", "content_quality"]) || null,
      join_date: parseFlexibleDate(pickPrefix(raw, ["join_date"])),
      domisili: pickPrefix(raw, ["domisili"]) || null,
      alamat: pick(raw, ["alamat_lengkap", "alamat"]) || null,
      jenis_creator: pick(raw, ["jenis_creator"]) || null,
      niche: topNiches?.[0] ?? null,
      top_niches: topNiches,
      rc_live: pick(raw, ["rc_live", "ratecard_live"]) || null,
      rc_video: pick(raw, ["rc_video", "ratecard_vt", "ratecard_video"]) || null,
      level: parseLevel(pick(raw, ["level_creator", "level"])),
      target_gmv_monthly: parseRupiah(pickPrefix(raw, ["target_gmv"])),
      total_konten: parseCount(pick(raw, ["total_konten"])),
      notes_endorsement: pick(raw, ["notes_endorsement", "notes"]) || null,
      contract_end_date:
        parseFlexibleDate(pick(raw, ["end_date_kontrak_tertulis", "contract_end_date"])) ??
        parseFlexibleDate(pick(raw, ["end_date_dashboard"])),
    };
    if (PLATFORMS.includes(platformRaw as (typeof PLATFORMS)[number])) payload.platform = platformRaw;
    if (SEGMENTS.includes(segmentRaw as (typeof SEGMENTS)[number])) payload.segment = segmentRaw;
    // GMV dari sheet hanya dipakai bila terisi — sumber utama = upload /metrics.
    if (gmv !== null) payload.gmv = gmv;
    if (gmvLive !== null) payload.gmv_live = gmvLive;
    if (gmvVideo !== null) payload.gmv_video = gmvVideo;
    // Drop null/empty supaya UPDATE tidak menghapus data yang sudah ada.
    for (const k of Object.keys(payload)) if (payload[k] === null) delete payload[k];

    const matchKey = (username || name).toLowerCase();
    const existingId = byKey.get(matchKey) ?? byKey.get(name.toLowerCase());

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
        status: STATUSES.includes(statusRaw as (typeof STATUSES)[number]) ? statusRaw : "prospek",
        ...payload,
      });
      if (!error) {
        inserted = true;
        byKey.set(matchKey, id);
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

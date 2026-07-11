"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";
import { parseCount, pick, pickPrefix } from "@/lib/platform-csv";
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

/** "Lv 0" / "Lv 3" / "3" → level int 1..6 (0 / kosong / tak valid → null). */
function parseLevel(raw: string): number | null {
  const m = raw.match(/(\d)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 6 ? n : null;
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
  const { data: existing } = await admin.from("creators").select("id, name, username").limit(5000);
  const byKey = new Map<string, string>();
  for (const c of existing ?? []) {
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

/**
 * Edit data master creator (jalur edit per-field dari halaman detail).
 * Field yang BOLEH diedit: identitas + atribut master. Field auto-computed /
 * sync platform — gmv, gmv_live, gmv_video, commission_share — TIDAK termasuk
 * (read-only, CLAUDE.md #4/#3): tidak pernah menerima nilai dari form ini.
 * Permission setara updateRateCard/uploadCreators ("creators.bulk_upload").
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const creatorEditSchema = z.object({
  creator_id: z.string().min(1, "creator_id wajib"),
  name: z.string().trim().min(1, "Nama creator wajib diisi"),
  username: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  profile_link: z.string().trim().optional().default(""),
  uid: z.string().trim().optional().default(""),
  followers: z.string().trim().optional().default(""),
  content_quality: z.string().trim().optional().default(""),
  join_date: z.string().trim().optional().default(""),
  domisili: z.string().trim().optional().default(""),
  jenis_creator: z.string().trim().optional().default(""),
  niche: z.string().trim().optional().default(""),
  level: z.string().trim().optional().default(""),
  platform: z.string().trim().optional().default(""),
  status: z.string().trim().optional().default(""),
  contract_end_date: z.string().trim().optional().default(""),
  target_gmv_monthly: z.string().trim().optional().default(""),
});

export interface CreatorEditState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

export async function updateCreator(
  _prev: CreatorEditState | null,
  formData: FormData
): Promise<CreatorEditState> {
  const actor = await requirePermission("creators.bulk_upload");

  const parsed = creatorEditSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors };
  }
  const d = parsed.data;
  const fieldErrors: Record<string, string> = {};

  // level: 1..6 (kosong → null)
  let level: number | null = null;
  if (d.level) {
    const n = Number(d.level);
    if (!Number.isInteger(n) || n < 1 || n > 6) fieldErrors.level = "Level harus 1-6";
    else level = n;
  }

  // platform: enum tiktok/shopee (kosong → null)
  let platform: string | null = null;
  if (d.platform) {
    if (!PLATFORMS.includes(d.platform as (typeof PLATFORMS)[number])) fieldErrors.platform = "Platform tidak valid";
    else platform = d.platform;
  }

  // status: enum wajib (default DB 'prospek')
  if (!d.status) fieldErrors.status = "Status wajib dipilih";
  else if (!STATUSES.includes(d.status as (typeof STATUSES)[number])) fieldErrors.status = "Status tidak valid";

  // tanggal: kosong → null, jika terisi wajib format YYYY-MM-DD (dari date picker)
  let joinDate: string | null = null;
  if (d.join_date) {
    if (!DATE_RE.test(d.join_date)) fieldErrors.join_date = "Tanggal tidak valid";
    else joinDate = d.join_date;
  }
  let contractEnd: string | null = null;
  if (d.contract_end_date) {
    if (!DATE_RE.test(d.contract_end_date)) fieldErrors.contract_end_date = "Tanggal tidak valid";
    else contractEnd = d.contract_end_date;
  }

  // target GMV bulanan: angka ≥ 0 (kosong → null)
  let targetGmv: number | null = null;
  if (d.target_gmv_monthly) {
    const n = Number(d.target_gmv_monthly);
    if (!Number.isFinite(n) || n < 0) fieldErrors.target_gmv_monthly = "Target GMV harus angka ≥ 0";
    else targetGmv = n;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors };
  }

  // Field editable saja — gmv/gmv_live/gmv_video/commission_share sengaja TIDAK ada di sini.
  const payload = {
    name: d.name,
    username: d.username || null,
    phone: d.phone || null,
    profile_link: d.profile_link || null,
    uid: d.uid || null,
    followers: d.followers || null,
    content_quality: d.content_quality || null,
    join_date: joinDate,
    domisili: d.domisili || null,
    jenis_creator: d.jenis_creator || null,
    niche: d.niche || null,
    level,
    platform,
    status: d.status,
    contract_end_date: contractEnd,
    target_gmv_monthly: targetGmv,
  };

  const admin = createAdminClient();
  const beforeCols =
    "name, username, phone, profile_link, uid, followers, content_quality, join_date, domisili, jenis_creator, niche, level, platform, status, contract_end_date, target_gmv_monthly";
  const { data: before } = await admin
    .from("creators").select(beforeCols).eq("id", d.creator_id).maybeSingle();
  if (!before) return { ok: false, message: `Creator ${d.creator_id} tidak ditemukan.` };

  const { error } = await admin.from("creators").update(payload).eq("id", d.creator_id);
  if (error) return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "creator.edit",
    entityType: "creators",
    entityId: d.creator_id,
    before,
    after: payload,
    type: "auto",
  });

  revalidatePath("/creators");
  revalidatePath(`/creators/${d.creator_id}`);
  return { ok: true, message: `Data creator ${d.creator_id} tersimpan.` };
}

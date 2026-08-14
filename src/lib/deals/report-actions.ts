"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";
import { pick, pickPrefix, resolveCreatorNames } from "@/lib/platform-csv";
import {
  buildReportCreatorTemplate,
  buildReportSessionTemplate,
  REPORT_CREATOR_TEMPLATE_FILENAME,
  REPORT_SESSION_TEMPLATE_FILENAME,
} from "@/lib/deals/report-template";
import type { UploadReport } from "@/app/(portal)/tim/actions";

/** "$75.25" / "$3,100" / "-" → number USD, null bila kosong/strip. */
function parseUsd(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseRoas(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tracking report campaign BD punya DUA pemilik: satu brand deal (tab Deal Brand)
 * atau satu Project BD (beberapa shop digarap bersama). Format filenya sama persis,
 * jadi parsernya satu dan tabelnya satu — yang berbeda cuma kolom pemilik
 * (deal_id / project_id, tepat satu terisi; migrasi 0044).
 */
interface ReportOwner {
  column: "deal_id" | "project_id";
  id: string;
  /** Halaman yang di-revalidate setelah tulis. */
  path: string;
}

/**
 * Menentukan pemilik report dari FormData. Keberadaannya diverifikasi di sini,
 * bukan diserahkan ke foreign key: pesan "Project PRJ-X tidak ditemukan" jauh lebih
 * berguna daripada pelanggaran constraint.
 */
async function resolveOwner(
  formData: FormData,
  admin: ReturnType<typeof createAdminClient>
): Promise<ReportOwner> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (projectId) {
    const { data } = await admin
      .from("bd_projects").select("id").eq("id", projectId).maybeSingle();
    if (!data) throw new Error(`Project ${projectId} tidak ditemukan`);
    return { column: "project_id", id: projectId, path: `/bd-projects/${projectId}` };
  }

  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) throw new Error("deal_id atau project_id wajib");
  const { data } = await admin
    .from("brand_deals").select("id").eq("id", dealId).maybeSingle();
  if (!data) throw new Error(`Deal ${dealId} tidak ditemukan`);
  return { column: "deal_id", id: dealId, path: `/deals/${dealId}` };
}

// Batch upload dikunci per pemilik. ID deal (DEAL-xxx) & project (PRJ-xxx) tidak
// pernah bertabrakan, jadi satu format kunci cukup untuk keduanya.
const sessionBatch = (ownerId: string) => `dls:${ownerId}`;
const proposalBatch = (ownerId: string) => `dcp:${ownerId}`;

/**
 * Tracking report campaign BD per sesi live (contoh: "Femmy x MEA - Report
 * Performance"). Kolom: id, Brand, Nama Creator, Tanggal Session Live, Event,
 * Support Ads, Ads Spending, IDR, SS Dashboard (link), GMV, ROAS.
 * File asli punya baris preamble (BULK-xxx) sebelum header + baris TOTAL —
 * keduanya ditangani. Re-upload = replace batch upload pemilik ini (input manual aman).
 */
export async function uploadReportSessions(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("m8.brand_report");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const admin = createAdminClient();
  const owner = await resolveOwner(formData, admin);

  const { rows, errors } = await parseSheet(file, ["nama_creator"]);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };

  const { byName, createdProspects } = await resolveCreatorNames(
    admin,
    rows.map((r) => pick(r, ["nama_creator"])),
    actor.id
  );

  const inserts: Record<string, unknown>[] = [];
  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;
    const creatorName = pick(raw, ["nama_creator"]);
    if (!creatorName) continue; // baris TOTAL / footer / kosong
    const sessionDate = parseFlexibleDate(pick(raw, ["tanggal_session_live", "tanggal"]));
    const gmv = parseRupiah(pick(raw, ["gmv"]));
    if (!sessionDate && gmv === null) {
      report.skipped.push({ row: rowNum, reason: `tanggal & GMV tidak terbaca (${creatorName})` });
      continue;
    }

    inserts.push({
      [owner.column]: owner.id,
      creator_id: byName.get(creatorName.toLowerCase()) ?? null,
      creator_name: creatorName,
      session_date: sessionDate,
      event: pick(raw, ["event"]) || null,
      support_ads: pick(raw, ["support_ads"]) || null,
      ads_spend_usd: parseUsd(pick(raw, ["ads_spending"])),
      ads_spend_idr: parseRupiah(pick(raw, ["idr"])),
      ss_link: pickPrefix(raw, ["ss_dashboard"]) || null,
      gmv: gmv ?? 0,
      roas: parseRoas(pick(raw, ["roas"])),
      upload_batch: sessionBatch(owner.id),
      created_by: actor.id,
    });
    report.inserted++;
  }

  // Replace hanya batch upload; baris input manual (upload_batch null) tetap.
  const { error: delError } = await admin
    .from("deal_live_sessions").delete().eq("upload_batch", sessionBatch(owner.id));
  if (delError) throw new Error(`Gagal membersihkan batch lama: ${delError.message}`);
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await admin.from("deal_live_sessions").insert(inserts.slice(i, i + 500));
    if (error) throw new Error(`Gagal menyimpan report sesi: ${error.message}`);
  }

  await writeAudit({
    actorId: actor.id,
    action: "m8.deal_report_upload",
    entityType: "deal_live_sessions",
    entityId: owner.id,
    after: { rows: report.inserted, file: file.name, created_prospects: createdProspects },
    type: "auto",
  });
  for (const name of createdProspects) {
    report.skipped.push({ row: -1, reason: `creator "${name}" belum ada di master → dibuat sebagai prospek (review)` });
  }

  revalidatePath(owner.path);
  return report;
}

/** Input manual satu sesi live (alternatif upload file). */
export async function addReportSession(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.brand_report");
  const creatorName = String(formData.get("creator_name") ?? "").trim();
  if (!creatorName) throw new Error("Nama creator wajib");

  const admin = createAdminClient();
  const owner = await resolveOwner(formData, admin);
  const { byName } = await resolveCreatorNames(admin, [creatorName], actor.id);

  const row = {
    [owner.column]: owner.id,
    creator_id: byName.get(creatorName.toLowerCase()) ?? null,
    creator_name: creatorName,
    session_date: parseFlexibleDate(String(formData.get("session_date") ?? "")) ?? null,
    event: String(formData.get("event") ?? "").trim() || null,
    ads_spend_usd: parseUsd(String(formData.get("ads_spend_usd") ?? "")),
    ads_spend_idr: parseRupiah(String(formData.get("ads_spend_idr") ?? "")),
    ss_link: String(formData.get("ss_link") ?? "").trim() || null,
    gmv: parseRupiah(String(formData.get("gmv") ?? "")) ?? 0,
    roas: parseRoas(String(formData.get("roas") ?? "")),
    upload_batch: null,
    created_by: actor.id,
  };
  const { error } = await admin.from("deal_live_sessions").insert(row);
  if (error) throw new Error(`Gagal menyimpan sesi: ${error.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "m8.deal_session_add",
    entityType: "deal_live_sessions",
    entityId: owner.id,
    after: row,
    type: "auto",
  });
  revalidatePath(owner.path);
}

/**
 * Upload daftar creator campaign (contoh: "Creator TC & Celeb"): usulan creator
 * per brand deal / project termasuk kreator exclusive MEA. Baris anotasi
 * ("CM / Otomatis") di bawah header di-skip.
 */
export async function uploadReportCreators(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("m8.brand_report");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const admin = createAdminClient();
  const owner = await resolveOwner(formData, admin);

  const { rows, errors } = await parseSheet(file, ["username"]);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };

  const inserts: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const username = pick(raw, ["username"]);
    if (!username) continue;
    // Baris anotasi di bawah header ("CM", "Otomatis", "Campaign", ...).
    if (["cm", "otomatis", "campaign", "brand"].includes(username.toLowerCase())) continue;

    inserts.push({
      [owner.column]: owner.id,
      username,
      profile_link: pickPrefix(raw, ["link_profile"]) || null,
      cm_name: pickPrefix(raw, ["creator_manager"]) || null,
      tipe_kreator: pick(raw, ["tipe_kreator"]) || null,
      channel: pick(raw, ["channel"]) || null,
      gmv_l30d: parseRupiah(pickPrefix(raw, ["gmv_l30d"])),
      requirement: pickPrefix(raw, ["creator_requirement"]) || null,
      rc_live: pickPrefix(raw, ["ratecard_live", "rc_live"]) || null,
      rc_vt: pickPrefix(raw, ["ratecard_vt", "rc_vt", "rc_video"]) || null,
      product_link: pickPrefix(raw, ["link_produk"]) || null,
      domisili: pick(raw, ["domisili"]) || null,
      alamat: pickPrefix(raw, ["alamat"]) || null,
      phone: pickPrefix(raw, ["no_hp"]) || null,
      brand_approval: pick(raw, ["brand_approval"]) || null,
      creator_approval: pick(raw, ["creator_approval"]) || null,
      shipping_status: pick(raw, ["status_pengiriman"]) || null,
      resi: pick(raw, ["no_resi"]) || null,
      notes: pick(raw, ["notes"]) || null,
      link_vt: pick(raw, ["link_vt"]) || null,
      boost_code: pick(raw, ["boost_code"]) || null,
      is_exclusive: /exclusive/i.test(pickPrefix(raw, ["creator_requirement"]) + pick(raw, ["tipe_kreator"])),
      upload_batch: proposalBatch(owner.id),
    });
    report.inserted++;
  }

  const { error: delError } = await admin
    .from("deal_creator_proposals").delete().eq("upload_batch", proposalBatch(owner.id));
  if (delError) throw new Error(`Gagal membersihkan batch lama: ${delError.message}`);
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await admin.from("deal_creator_proposals").insert(inserts.slice(i, i + 500));
    if (error) throw new Error(`Gagal menyimpan daftar creator: ${error.message}`);
  }

  await writeAudit({
    actorId: actor.id,
    action: "m8.deal_proposals_upload",
    entityType: "deal_creator_proposals",
    entityId: owner.id,
    after: { rows: report.inserted, file: file.name },
    type: "auto",
  });

  revalidatePath(owner.path);
  return report;
}

/**
 * Template .xlsx untuk kedua upload di atas.
 *
 * Headernya dibangun dari daftar kolom yang sama dengan yang dibaca parser
 * (lib/deals/report-template.ts), jadi file hasil unduh bisa langsung diisi dan
 * diunggah kembali tanpa penyesuaian — persoalan "upload 0 baris karena nama kolom
 * beda" tidak perlu ditemukan user lewat percobaan.
 *
 * Dikembalikan sebagai base64 karena server action hanya boleh mengembalikan nilai
 * serializable; klien merakitnya kembali lewat downloadBase64File().
 */
export async function downloadReportSessionTemplate(): Promise<{ filename: string; base64: string }> {
  await requirePermission("m8.brand_report");
  return {
    filename: REPORT_SESSION_TEMPLATE_FILENAME,
    base64: Buffer.from(buildReportSessionTemplate()).toString("base64"),
  };
}

export async function downloadReportCreatorTemplate(): Promise<{ filename: string; base64: string }> {
  await requirePermission("m8.brand_report");
  return {
    filename: REPORT_CREATOR_TEMPLATE_FILENAME,
    base64: Buffer.from(buildReportCreatorTemplate()).toString("base64"),
  };
}

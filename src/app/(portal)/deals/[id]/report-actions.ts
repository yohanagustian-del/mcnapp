"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";
import { pick, pickPrefix, resolveCreatorNames } from "@/lib/platform-csv";
import { recordPendingCreators } from "@/lib/creators/pending";
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

const sessionBatch = (dealId: string) => `dls:${dealId}`;
const proposalBatch = (dealId: string) => `dcp:${dealId}`;

/**
 * Tracking report campaign BD per sesi live (contoh: "Femmy x MEA - Report
 * Performance"). Kolom: id, Brand, Nama Creator, Tanggal Session Live, Event,
 * Support Ads, Ads Spending, IDR, SS Dashboard (link), GMV, ROAS.
 * File asli punya baris preamble (BULK-xxx) sebelum header + baris TOTAL —
 * keduanya ditangani. Re-upload = replace batch upload deal (input manual aman).
 */
export async function uploadDealSessions(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("m8.brand_report");
  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) throw new Error("deal_id wajib");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file, ["nama_creator"]);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  const admin = createAdminClient();

  const { data: deal } = await admin
    .from("brand_deals").select("id").eq("id", dealId).maybeSingle();
  if (!deal) throw new Error(`Deal ${dealId} tidak ditemukan`);

  // Migration 0028: nama kreator yang belum terdaftar TIDAK dibuat otomatis.
  // Baris report tetap disimpan (creator_id boleh null, nama tetap tercatat) dan
  // username-nya masuk daftar tunggu untuk didaftarkan akuisisi.
  const { byName, unresolved } = await resolveCreatorNames(
    admin,
    rows.map((r) => pick(r, ["nama_creator"]))
  );
  if (unresolved.length > 0) {
    await recordPendingCreators(admin, {
      usernames: unresolved,
      source: "deal_report",
      actorId: actor.id,
    });
  }

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
      deal_id: dealId,
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
      upload_batch: sessionBatch(dealId),
      created_by: actor.id,
    });
    report.inserted++;
  }

  // Replace hanya batch upload; baris input manual (upload_batch null) tetap.
  const { error: delError } = await admin
    .from("deal_live_sessions").delete().eq("upload_batch", sessionBatch(dealId));
  if (delError) throw new Error(`Gagal membersihkan batch lama: ${delError.message}`);
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await admin.from("deal_live_sessions").insert(inserts.slice(i, i + 500));
    if (error) throw new Error(`Gagal menyimpan report sesi: ${error.message}`);
  }

  await writeAudit({
    actorId: actor.id,
    action: "m8.deal_report_upload",
    entityType: "deal_live_sessions",
    entityId: dealId,
    after: { rows: report.inserted, file: file.name, pending_creators: unresolved },
    type: "auto",
  });
  for (const name of unresolved) {
    report.skipped.push({
      row: -1,
      reason:
        `creator "${name}" belum terdaftar di master → baris tetap tersimpan tanpa tautan kreator, ` +
        `username masuk Daftar Tunggu Kreator (approve di Acquisition Workspace).`,
    });
  }

  revalidatePath(`/deals/${dealId}`);
  return report;
}

/** Input manual satu sesi live (alternatif upload file). */
export async function addDealSession(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.brand_report");
  const dealId = String(formData.get("deal_id") ?? "").trim();
  const creatorName = String(formData.get("creator_name") ?? "").trim();
  if (!dealId || !creatorName) throw new Error("deal_id & nama creator wajib");

  const admin = createAdminClient();
  const { byName } = await resolveCreatorNames(admin, [creatorName]);

  const row = {
    deal_id: dealId,
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
    entityId: dealId,
    after: row,
    type: "auto",
  });
  revalidatePath(`/deals/${dealId}`);
}

/**
 * Upload daftar creator campaign (contoh: "Creator TC & Celeb"): usulan creator
 * per brand deal termasuk kreator exclusive MEA. Baris anotasi ("CM / Otomatis")
 * di bawah header di-skip.
 */
export async function uploadCreatorProposals(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("m8.brand_report");
  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) throw new Error("deal_id wajib");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file, ["username"]);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  const admin = createAdminClient();

  const inserts: Record<string, unknown>[] = [];
  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;
    const username = pick(raw, ["username"]);
    if (!username) continue;
    // Baris anotasi di bawah header ("CM", "Otomatis", "Campaign", ...).
    if (["cm", "otomatis", "campaign", "brand"].includes(username.toLowerCase())) continue;

    inserts.push({
      deal_id: dealId,
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
      upload_batch: proposalBatch(dealId),
    });
    report.inserted++;
    void rowNum;
  }

  const { error: delError } = await admin
    .from("deal_creator_proposals").delete().eq("upload_batch", proposalBatch(dealId));
  if (delError) throw new Error(`Gagal membersihkan batch lama: ${delError.message}`);
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await admin.from("deal_creator_proposals").insert(inserts.slice(i, i + 500));
    if (error) throw new Error(`Gagal menyimpan daftar creator: ${error.message}`);
  }

  await writeAudit({
    actorId: actor.id,
    action: "m8.deal_proposals_upload",
    entityType: "deal_creator_proposals",
    entityId: dealId,
    after: { rows: report.inserted, file: file.name },
    type: "auto",
  });

  revalidatePath(`/deals/${dealId}`);
  return report;
}

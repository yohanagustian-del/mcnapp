"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission, type TeamMember } from "@/lib/rbac";
import { assertCreatorInScope } from "@/lib/schedule/scope";
import { slotUploadEligibility } from "@/lib/schedule/live-report";
import type { SlotStatus } from "@/lib/schedule/types";
import {
  analyzeLiveSessionGroups, groupUploadedFiles, loadKnownUsernames, persistLiveSessions, toPreview,
  type LiveSessionOwner, type SessionGroupPreview, type SessionOverrides, type UnreadableFile,
} from "@/lib/m7/live-ingest";
import { buildSlotLiveReportData } from "@/lib/m7/report-data";
import { refreshSlotReportDataSafe } from "@/lib/m7/report-refresh";

/**
 * Data & report live stream untuk SATU slot Jadwal Live (M13, migrasi 0066).
 *
 * File yang diunggah = export TikTok LIVE Center (Product + Trend Stats), persis
 * sama dengan Special Project; parser/verifikasi/penyimpanan dipakai dari
 * lib/m7/live-ingest.ts (CLAUDE.md #4). Yang khas di sini:
 *  - Pemilik sesi = slot (`schedule_slot_id`), bukan project.
 *  - Izin unggah/batal = `schedule.edit` + scope CPM (kreator sendiri) — sama
 *    dengan yang boleh mengisi slotnya (keputusan user 2026-09-21).
 *  - Izin generate/finalisasi report = `reports.generate` / `reports.finalize`
 *    (PRD M2 §2.5) + scope CPM.
 *  - Report 0 LLM: angka + catatan deterministik (live-notes); narasi tim
 *    ditulis saat finalisasi.
 * Semua mutasi ditulis ke audit_logs (type auto — menambah data, tidak merugikan).
 */

export type { SessionGroupPreview, UnreadableFile };

export type PreviewResult =
  | { ok: true; sessions: SessionGroupPreview[]; unreadableFiles: UnreadableFile[] }
  | { ok: false; error: string };

export interface SaveResult {
  ok: boolean;
  saved: string[];
  skipped: { key: string; reason: string }[];
  error?: string;
}

export type SimpleResult = { ok: true } | { ok: false; error: string };
export type GenerateResult = { ok: true; reportId: number } | { ok: false; error: string };

interface SlotRow {
  id: number;
  creator_id: string;
  schedule_date: string;
  status: string;
  brand_name: string | null;
}

async function loadSlot(admin: ReturnType<typeof createAdminClient>, slotId: number): Promise<SlotRow> {
  const { data, error } = await admin
    .from("live_schedule_slots")
    .select("id, creator_id, schedule_date, status, brand_name")
    .eq("id", slotId)
    .maybeSingle();
  if (error) throw new Error(`Gagal membaca slot: ${error.message}`);
  if (!data) throw new Error("Slot jadwal tidak ditemukan.");
  return data as SlotRow;
}

/** Guard unggah: schedule.edit + scope CPM + slot layak (bukan OFF/batal/masa depan). */
async function requireSlotUploadAccess(
  admin: ReturnType<typeof createAdminClient>,
  slotId: number
): Promise<{ member: TeamMember; slot: SlotRow }> {
  const member = await requirePermission("schedule.edit");
  const slot = await loadSlot(admin, slotId);
  await assertCreatorInScope(admin, member, slot.creator_id);
  const eligibility = slotUploadEligibility(
    { status: slot.status as SlotStatus, schedule_date: slot.schedule_date },
    new Date().toISOString().slice(0, 10)
  );
  if (!eligibility.ok) throw new Error(eligibility.reason);
  return { member, slot };
}

function slotOwner(slot: SlotRow): LiveSessionOwner {
  return { kind: "slot", slotId: slot.id, scheduleDate: slot.schedule_date };
}

function revalidateSlot(slotId: number): void {
  revalidatePath("/schedule");
  revalidatePath(`/schedule/live/${slotId}`);
  revalidatePath(`/schedule/live/${slotId}/report`);
  revalidatePath("/reports");
}

export async function previewSlotLiveSessions(formData: FormData): Promise<PreviewResult> {
  try {
    const slotId = Number(formData.get("slot_id"));
    if (!slotId) throw new Error("Slot tidak valid");
    const admin = createAdminClient();
    const { slot } = await requireSlotUploadAccess(admin, slotId);

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Pilih minimal satu file untuk diunggah");

    const [tolerance, knownUsernames] = await Promise.all([
      getConfig<number>("m7.gmv_trend_tolerance"), loadKnownUsernames(admin, slot.creator_id),
    ]);
    const { groups, unreadable } = await groupUploadedFiles(files, knownUsernames);
    const analyzed = await analyzeLiveSessionGroups(admin, slotOwner(slot), slot.creator_id, groups, tolerance);
    return { ok: true, sessions: analyzed.map(toPreview), unreadableFiles: unreadable };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

export async function saveSlotLiveSessions(formData: FormData): Promise<SaveResult> {
  try {
    const slotId = Number(formData.get("slot_id"));
    if (!slotId) throw new Error("Slot tidak valid");
    const admin = createAdminClient();
    const { member, slot } = await requireSlotUploadAccess(admin, slotId);

    // Brand sesi default = brand slot; tim boleh menimpanya di form.
    const brand = String(formData.get("brand") ?? "").trim() || slot.brand_name?.trim() || null;
    let overrides: SessionOverrides = {};
    try {
      overrides = JSON.parse(String(formData.get("overrides") ?? "{}"));
    } catch {
      overrides = {};
    }

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Pilih minimal satu file untuk diunggah");

    const [tolerance, knownUsernames] = await Promise.all([
      getConfig<number>("m7.gmv_trend_tolerance"), loadKnownUsernames(admin, slot.creator_id),
    ]);
    const { groups, unreadable } = await groupUploadedFiles(files, knownUsernames);
    const owner = slotOwner(slot);
    const analyzed = await analyzeLiveSessionGroups(admin, owner, slot.creator_id, groups, tolerance);
    const result = await persistLiveSessions(admin, owner, slot.creator_id, analyzed, {
      actorId: member.id, brand, overrides,
    });
    const skipped = [...unreadable.map((f) => ({ key: f.name, reason: f.reason })), ...result.skipped];

    for (const [i, sessionId] of result.savedSessionIds.entries()) {
      const key = result.saved[i];
      const a = analyzed.find((g) => g.group.key === key);
      await writeAudit({
        actorId: member.id, action: "schedule.live_session_upload", entityType: "project_live_sessions",
        entityId: String(sessionId),
        after: {
          uploader_id: member.id, creator_id: slot.creator_id, schedule_slot_id: slotId, session_id: sessionId,
          checks_json: a?.checks ?? [], override_reason: overrides[key]?.reason ?? null,
        },
        type: "auto",
      });
    }

    if (result.saved.length > 0) await refreshSlotReportDataSafe(admin, slotId);
    revalidateSlot(slotId);
    return { ok: result.saved.length > 0, saved: result.saved, skipped };
  } catch (e) {
    return { ok: false, saved: [], skipped: [], error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Batalkan sesi milik slot → voided; file & nomor sesinya bebas dipakai ulang (0062/0063). */
export async function voidSlotLiveSession(formData: FormData): Promise<SimpleResult> {
  try {
    const sessionId = Number(formData.get("session_id"));
    if (!sessionId) throw new Error("Sesi tidak valid");
    const admin = createAdminClient();
    const member = await requirePermission("schedule.edit");

    const { data: session } = await admin
      .from("project_live_sessions")
      .select("id, schedule_slot_id, creator_id, attribution_status")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) throw new Error("Sesi tidak ditemukan");
    if (!session.schedule_slot_id) throw new Error("Sesi ini milik Special Project — batalkan dari halaman projectnya.");
    await assertCreatorInScope(admin, member, session.creator_id);
    if (session.attribution_status === "voided") return { ok: true };

    const { error } = await admin
      .from("project_live_sessions")
      .update({ attribution_status: "voided", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (error) throw new Error(`Gagal membatalkan sesi: ${error.message}`);

    await writeAudit({
      actorId: member.id, action: "schedule.live_session_void", entityType: "project_live_sessions",
      entityId: String(sessionId), before: { attribution_status: session.attribution_status },
      after: { attribution_status: "voided", schedule_slot_id: session.schedule_slot_id }, type: "auto",
    });

    await refreshSlotReportDataSafe(admin, session.schedule_slot_id);
    revalidateSlot(session.schedule_slot_id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Generate/segarkan report live stream slot. Satu draft + satu final per slot
 * (index parsial 0066): draft yang ada ditulis ulang; final yang ada disegarkan
 * ANGKANYA saja (narasi tim tidak disentuh) — aturan yang sama dengan report
 * project (report-actions.ts). Tanpa LLM: token_used selalu 0.
 */
export async function generateSlotReport(formData: FormData): Promise<GenerateResult> {
  try {
    const slotId = Number(formData.get("slot_id"));
    if (!slotId) throw new Error("Slot tidak valid");
    const admin = createAdminClient();
    const actor = await requirePermission("reports.generate");
    const slot = await loadSlot(admin, slotId);
    await assertCreatorInScope(admin, actor, slot.creator_id);

    const { count } = await admin
      .from("project_live_sessions")
      .select("id", { count: "exact", head: true })
      .eq("schedule_slot_id", slotId)
      .in("attribution_status", ["verified", "confirmed_manual"]);
    if (!count) throw new Error("Belum ada sesi live yang dihitung untuk slot ini — unggah file Product (+ Trend Stats) dulu.");

    const dataJson = await buildSlotLiveReportData(admin, slotId);
    const generatedAt = new Date().toISOString();

    const { data: existingRows } = await admin
      .from("creator_reports")
      .select("id, status")
      .eq("schedule_slot_id", slotId)
      .in("status", ["draft", "final"]);
    const existingDraft = (existingRows ?? []).find((r) => r.status === "draft") ?? null;
    const existingFinal = (existingRows ?? []).find((r) => r.status === "final") ?? null;

    let reportId: number;
    if (existingFinal) {
      const { error } = await admin
        .from("creator_reports")
        .update({ data_json: dataJson, generated_by: actor.id, generated_at: generatedAt })
        .eq("id", existingFinal.id);
      if (error) throw new Error(`Gagal memperbarui report final: ${error.message}`);
      reportId = existingFinal.id;
    }
    if (existingDraft) {
      const { error } = await admin
        .from("creator_reports")
        .update({ data_json: dataJson, generated_by: actor.id, generated_at: generatedAt, token_used: 0 })
        .eq("id", existingDraft.id);
      if (error) throw new Error(`Gagal memperbarui draft: ${error.message}`);
      reportId = existingDraft.id;
    } else if (!existingFinal) {
      const { data: inserted, error } = await admin
        .from("creator_reports")
        .insert({
          creator_id: slot.creator_id, schedule_slot_id: slotId, period_type: "live_session",
          period_start: dataJson.period.start, data_json: dataJson,
          insight_draft: null, status: "draft", token_used: 0, generated_by: actor.id,
        })
        .select("id").single();
      if (error) throw new Error(`Gagal membuat report: ${error.message}`);
      reportId = inserted.id;
      // PRD M2 §2.6: bukti fungsi CM berjalan — report dari jadwal ikut dihitung.
      await admin.from("cpm_report_activity").insert({
        cpm_id: actor.id, creator_id: slot.creator_id, period_type: "live_session", has_insight: false,
      });
    }

    await writeAudit({
      actorId: actor.id, action: "schedule.report_generate", entityType: "creator_reports",
      entityId: String(reportId!),
      after: { schedule_slot_id: slotId, creator_id: slot.creator_id, token_used: 0, refreshed_final: Boolean(existingFinal) },
      type: "auto",
    });

    revalidateSlot(slotId);
    return { ok: true, reportId: reportId! };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Finalisasi report slot (human-in-the-loop): narasi tim ditulis, report dikunci, kreator bisa melihat di portal. */
export async function finalizeSlotReport(formData: FormData): Promise<SimpleResult> {
  try {
    const reportId = Number(formData.get("report_id"));
    const insightFinal = String(formData.get("insight_final") ?? "").trim();
    if (!reportId) throw new Error("Report tidak valid");
    const admin = createAdminClient();
    const actor = await requirePermission("reports.finalize");

    const { data: report } = await admin
      .from("creator_reports")
      .select("id, schedule_slot_id, creator_id, status, insight_draft")
      .eq("id", reportId).maybeSingle();
    if (!report) throw new Error("Report tidak ditemukan");
    if (!report.schedule_slot_id) throw new Error("Report ini bukan report slot Jadwal Live");
    if (report.status === "final") throw new Error("Report sudah final");
    await assertCreatorInScope(admin, actor, report.creator_id);

    const { data: previousFinal } = await admin
      .from("creator_reports").select("id")
      .eq("schedule_slot_id", report.schedule_slot_id).eq("status", "final").maybeSingle();
    if (previousFinal) await admin.from("creator_reports").delete().eq("id", previousFinal.id);

    const { error } = await admin
      .from("creator_reports")
      .update({ status: "final", insight_final: insightFinal || report.insight_draft, finalized_by: actor.id })
      .eq("id", reportId);
    if (error) throw new Error(`Gagal finalisasi: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "schedule.report_finalize", entityType: "creator_reports", entityId: String(reportId),
      before: { status: report.status }, after: { status: "final", replaced_previous_final: Boolean(previousFinal) },
      type: "auto",
    });

    revalidateSlot(report.schedule_slot_id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

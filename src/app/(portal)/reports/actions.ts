"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission, type TeamMember } from "@/lib/rbac";
import type { PeriodType } from "@/lib/report/aggregate";
import { buildCreatorReportData } from "@/lib/report/build";
import type { LiveBenchmarks, ReportRules } from "@/lib/report/rules";
import { isReportV2, type ReportEdits } from "@/lib/report/types";

export interface ReportActionState {
  ok: boolean;
  message: string;
  reportId?: number;
}

const generateSchema = z.object({
  creator_id: z.string().min(1, "Creator wajib dipilih"),
  period_type: z.enum(["weekly", "monthly"]),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal awal periode wajib"),
});

/** CPM may only act on creators they own (PRD M2 §2.5 — server-enforced). */
async function assertCreatorScope(actor: TeamMember, ownerCpmId: string | null) {
  if (actor.role === "cpm" && ownerCpmId !== actor.id) {
    throw new Error("Akses ditolak: CPM hanya bisa membuat report untuk creator yang di-handle sendiri");
  }
}

/**
 * M2 generate (versi 2, 2026-09-21): AGREGASI DETERMINISTIK PENUH, 0 token AI.
 *
 * Seluruh report — angka, insight box, badge produk, rekomendasi, ringkasan
 * eksekutif — dihasilkan `lib/report/build.ts` + `lib/report/rules.ts` dari
 * data yang sudah ada. Tidak ada panggilan LLM sama sekali, jadi gate
 * skip-LLM (`m2.delta_threshold`) dan ratchet token tidak lagi berlaku untuk
 * report baru; keduanya dibiarkan utuh di kode untuk report lama yang sudah
 * tersimpan dengan `token_used > 0`.
 */
export async function generateReport(
  _prev: ReportActionState | null,
  formData: FormData
): Promise<ReportActionState> {
  const actor = await requirePermission("reports.generate");
  const parsed = generateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { creator_id, period_type, period_start } = parsed.data;
  const periodType = period_type as PeriodType;

  const supabase = await createClient();
  const { data: creator } = await supabase
    .from("creators")
    .select("id, name, owner_cpm_id")
    .eq("id", creator_id)
    .maybeSingle();
  if (!creator) return { ok: false, message: `Creator ${creator_id} tidak ditemukan` };
  await assertCreatorScope(actor, creator.owner_cpm_id);

  // Ambang & benchmark WAJIB dari app_config (CLAUDE.md: jangan hardcode).
  // Keduanya di-seed migrasi 0066 — kalau belum ada, katakan apa adanya
  // daripada diam-diam memakai angka bawaan kode.
  let rules: ReportRules;
  let benchmarks: LiveBenchmarks;
  try {
    [rules, benchmarks] = await Promise.all([
      getConfig<ReportRules>("m2.report_rules"),
      getConfig<LiveBenchmarks>("m2.live_benchmarks"),
    ]);
  } catch (e) {
    return {
      ok: false,
      message: `Konfigurasi report belum ada di app_config (${e instanceof Error ? e.message : "error"}). Migrasi 0066 belum di-apply?`,
    };
  }

  let dataJson;
  try {
    dataJson = await buildCreatorReportData(supabase, {
      creatorId: creator_id, periodType, periodStart: period_start, rules, benchmarks,
    });
  } catch (e) {
    return { ok: false, message: `Gagal merakit report: ${e instanceof Error ? e.message : "error"}` };
  }

  if (dataJson.period.weeks_counted === 0 && !dataJson.live.available) {
    return {
      ok: false,
      message: `Tidak ada data periode untuk ${creator.name} pada ${dataJson.period.start} — upload dulu di /ingest atau Data Platform.`,
    };
  }

  // ===== Persist (service role — users have read-only access to reports) =====
  const admin = createAdminClient();
  const { data: report, error } = await admin
    .from("creator_reports")
    .insert({
      creator_id,
      period_type: periodType,
      period_start: dataJson.period.start,
      data_json: dataJson,
      // Ringkasan eksekutif rule-based disimpan juga sebagai insight_draft supaya
      // daftar/preview lama (yang hanya membaca kolom ini) tetap bermakna.
      insight_draft: dataJson.summary,
      status: "draft",
      token_used: 0,
      generated_by: actor.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Gagal menyimpan report: ${error.message}` };

  await admin.from("cpm_report_activity").insert({
    cpm_id: actor.id,
    creator_id,
    period_type: periodType,
    // Report v2 SELALU bernarasi (rule-based). `token_used` = 0 tetap penanda
    // bahwa tidak ada LLM yang dipakai — bukan kolom ini.
    has_insight: true,
  });

  await writeAudit({
    actorId: actor.id,
    action: "report.generate",
    entityType: "creator_reports",
    entityId: String(report.id),
    after: {
      creator_id, period_type: periodType, period_start: dataJson.period.start,
      token_used: 0, schema_version: dataJson.schema_version,
      weeks_counted: dataJson.period.weeks_counted, live_sessions: dataJson.live.sessions,
    },
    type: "auto",
  });

  revalidatePath("/reports");
  return {
    ok: true,
    message: `Report ${creator.name} (${periodType}, ${dataJson.period.label}) tersimpan sebagai draft dari ${dataJson.period.weeks_counted} minggu data` +
      `${dataJson.live.available ? ` dan ${dataJson.live.sessions} sesi live` : ""}. 0 token AI.`,
    reportId: report.id,
  };
}

const editSchema = z.object({
  report_id: z.coerce.number().int(),
  section: z.enum(["summary", "insight", "recommendation"]),
  key: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
});

/**
 * Sunting TEKS report v2 (tombol "Edit Report"). Hanya teks — ringkasan,
 * judul/isi insight box, dan rekomendasi; angka tidak pernah bisa disunting
 * (kalau angkanya salah, datanya yang diperbaiki lalu report di-generate ulang).
 * Hanya saat draft: report final terkunci.
 */
export async function saveReportEdits(
  _prev: ReportActionState | null,
  formData: FormData
): Promise<ReportActionState> {
  const actor = await requirePermission("reports.finalize");
  const parsed = editSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { report_id, section, key, title, text } = parsed.data;
  if (section !== "summary" && !key) return { ok: false, message: "Bagian yang disunting tidak dikenali" };

  const { report, edits, error } = await loadEditableReport(report_id, actor);
  if (error) return { ok: false, message: error };

  const next: ReportEdits = { ...edits };
  if (section === "summary") {
    next.summary = text ?? "";
  } else if (section === "insight") {
    next.insights = { ...(next.insights ?? {}), [key!]: { title, text } };
  } else {
    next.recommendations = { ...(next.recommendations ?? {}), [key!]: text ?? "" };
  }

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("creator_reports").update({ edits_json: next }).eq("id", report_id);
  if (updateError) return { ok: false, message: `Gagal menyimpan suntingan: ${updateError.message}` };

  await writeAudit({
    actorId: actor.id, action: "report.edit", entityType: "creator_reports", entityId: String(report_id),
    before: { section, key: key ?? null, previous: edits ?? null },
    after: { section, key: key ?? null },
    type: "auto",
  });

  revalidatePath(`/reports/${report_id}`);
  return { ok: true, message: "Suntingan tersimpan.", reportId: report!.id };
}

/** Kembalikan satu bagian ke teks otomatis (rule-based) — menghapus override-nya. */
export async function resetReportSection(
  _prev: ReportActionState | null,
  formData: FormData
): Promise<ReportActionState> {
  const actor = await requirePermission("reports.finalize");
  const reportId = Number(formData.get("report_id"));
  const section = String(formData.get("section") ?? "");
  const key = String(formData.get("key") ?? "");
  if (!Number.isInteger(reportId)) return { ok: false, message: "report_id tidak valid" };

  const { edits, error } = await loadEditableReport(reportId, actor);
  if (error) return { ok: false, message: error };

  const next: ReportEdits = { ...edits };
  if (section === "summary") delete next.summary;
  else if (section === "insight" && next.insights) delete next.insights[key];
  else if (section === "recommendation" && next.recommendations) delete next.recommendations[key];
  else return { ok: false, message: "Bagian yang direset tidak dikenali" };

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("creator_reports").update({ edits_json: next }).eq("id", reportId);
  if (updateError) return { ok: false, message: `Gagal mengembalikan teks otomatis: ${updateError.message}` };

  await writeAudit({
    actorId: actor.id, action: "report.edit", entityType: "creator_reports", entityId: String(reportId),
    before: { section, key: key || null, previous: edits ?? null },
    after: { section, key: key || null, reset: true },
    type: "auto",
  });

  revalidatePath(`/reports/${reportId}`);
  return { ok: true, message: "Kembali ke teks otomatis." };
}

/** Gerbang bersama saveReportEdits/resetReportSection: draft, v2, dan dalam scope CPM. */
async function loadEditableReport(
  reportId: number,
  actor: TeamMember
): Promise<{ report?: { id: number }; edits: ReportEdits | null; error?: string }> {
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("creator_reports")
    .select("id, status, data_json, edits_json, creator_id, creators(owner_cpm_id)")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { edits: null, error: `Report #${reportId} tidak ditemukan` };
  if (report.status === "final") return { edits: null, error: "Report sudah final — teksnya terkunci." };
  if (!isReportV2(report.data_json)) {
    return { edits: null, error: "Report versi lama tidak bisa disunting per bagian — generate ulang dulu." };
  }
  try {
    await assertCreatorScope(actor, (report.creators as unknown as { owner_cpm_id: string | null } | null)?.owner_cpm_id ?? null);
  } catch (e) {
    return { edits: null, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  return { report: { id: report.id as number }, edits: (report.edits_json as ReportEdits | null) ?? null };
}

/**
 * Finalize (PRD §3.2 human-in-the-loop): reviewer edits the draft insight,
 * then locks the report as Final. Export = print view on the detail page.
 */
export async function finalizeReport(
  _prev: ReportActionState | null,
  formData: FormData
): Promise<ReportActionState> {
  const actor = await requirePermission("reports.finalize");
  const reportId = Number(formData.get("report_id"));
  const insightFinal = String(formData.get("insight_final") ?? "").trim();
  if (!Number.isInteger(reportId)) return { ok: false, message: "report_id tidak valid" };

  const supabase = await createClient();
  const { data: report } = await supabase
    .from("creator_reports")
    .select("id, status, insight_draft, creator_id, creators(owner_cpm_id)")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { ok: false, message: `Report #${reportId} tidak ditemukan` };
  if (report.status === "final") return { ok: false, message: "Report sudah final." };
  await assertCreatorScope(actor, (report.creators as unknown as { owner_cpm_id: string | null } | null)?.owner_cpm_id ?? null);

  const admin = createAdminClient();
  const { error } = await admin
    .from("creator_reports")
    .update({
      status: "final",
      insight_final: insightFinal || report.insight_draft,
      finalized_by: actor.id,
    })
    .eq("id", reportId);
  if (error) return { ok: false, message: `Gagal finalisasi: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "report.finalize",
    entityType: "creator_reports",
    entityId: String(reportId),
    before: { status: report.status },
    after: { status: "final", edited: insightFinal !== "" && insightFinal !== report.insight_draft },
    type: "auto",
  });

  revalidatePath("/reports");
  revalidatePath(`/reports/${reportId}`);
  return { ok: true, message: `Report #${reportId} difinalisasi. Siap di-export (print → PDF).`, reportId };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

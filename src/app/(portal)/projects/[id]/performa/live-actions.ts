"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { hasPermission, requireMember, type TeamMember } from "@/lib/rbac";
import { canUploadProjectPerformance, isAssignedManpower } from "@/lib/m7/access";
import { parseLiveFilename } from "@/lib/m7/live-filename";
import {
  analyzeLiveSessionGroups, groupUploadedFiles, loadKnownUsernames, persistLiveSessions, toPreview,
  type LiveSessionOwner, type SessionGroupPreview, type SessionOverrides, type UnreadableFile,
} from "@/lib/m7/live-ingest";
import { verifyLiveSession } from "@/lib/m7/live-verify";
import { refreshCreatorReportDataSafe } from "@/lib/m7/report-refresh";

/**
 * Upload sesi live TikTok (PRD addendum §9/§10) — SELALU berkonteks satu kreator
 * (R40): tim pilih peserta dulu, lalu drop banyak file sekaligus (beberapa sesi,
 * beberapa hari). File dipasangkan Product+Trend per (username, sesi, tanggal)
 * dari NAMA FILE (isi file tidak membawa identitas itu sama sekali — §9).
 *
 * Dua panggilan terpisah, bukan satu commit langsung, supaya tim bisa melihat
 * hasil cek V1–V7 sebelum menyimpan apa pun (§10.2 langkah 3–4):
 *  - `previewLiveSessions`: parse + cek, TIDAK menulis apa pun.
 *  - `saveLiveSessions`: parse + cek ULANG (server tidak percaya hasil cek dari
 *    klien), lalu menyimpan sesi yang lolos (hijau, atau kuning yang sudah
 *    dikonfirmasi tim lewat `overrides`). Sesi merah tidak pernah disimpan.
 *
 * Intinya (grouping, analisa V1–V7, penyimpanan) ada di lib/m7/live-ingest.ts
 * dan dipakai juga oleh upload sesi dari Jadwal Live (migrasi 0066) — file ini
 * hanya menambahkan konteks project: RBAC, roll-up metrik project, refresh report.
 */

export type { SessionGroupPreview, UnreadableFile };

export type PreviewLiveSessionsResult =
  | { ok: true; sessions: SessionGroupPreview[]; unreadableFiles: UnreadableFile[] }
  | { ok: false; error: string };

export interface SaveLiveSessionsResult {
  ok: boolean;
  saved: string[]; // keys saved
  skipped: { key: string; reason: string }[];
  error?: string;
}

/**
 * Guard performa project (M7 §2.5): pemegang `m7.metrics` untuk semua project,
 * ATAU anggota tim yang di-assign sebagai man power in-charge di project ini —
 * aturannya di lib/m7/access, sama persis dengan guard peserta project.
 * Ditegakkan DI SERVER, bukan cuma disembunyikan di UI.
 */
async function requireProjectPerformanceAccess(
  admin: ReturnType<typeof createAdminClient>,
  projectId: number
): Promise<TeamMember> {
  const member = await requireMember();
  const hasMetrics = hasPermission("m7.metrics", member.role);
  const assigned = hasMetrics
    ? false // sudah lolos lewat permission global — tidak perlu query tambahan
    : await isAssignedManpower(admin, projectId, member.id);
  if (!canUploadProjectPerformance({ hasMetricsPermission: hasMetrics, isAssignedManpower: assigned })) {
    throw new Error(
      `Akses ditolak: role ${member.role} tidak punya izin m7.metrics dan belum di-assign sebagai man power project ini`
    );
  }
  return member;
}

async function projectOwner(
  admin: ReturnType<typeof createAdminClient>,
  projectId: number
): Promise<LiveSessionOwner> {
  const { data: project } = await admin
    .from("special_projects").select("start_date, end_date").eq("id", projectId).single();
  if (!project) throw new Error("Project tidak ditemukan");
  return { kind: "project", projectId, startDate: project.start_date, endDate: project.end_date };
}

export async function previewLiveSessions(formData: FormData): Promise<PreviewLiveSessionsResult> {
  try {
    const projectId = Number(formData.get("project_id"));
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    if (!projectId || !creatorId) throw new Error("Project & peserta wajib dipilih");

    const admin = createAdminClient();
    await requireProjectPerformanceAccess(admin, projectId);

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Pilih minimal satu file untuk diunggah");

    const [owner, tolerance, knownUsernames] = await Promise.all([
      projectOwner(admin, projectId), getConfig<number>("m7.gmv_trend_tolerance"),
      loadKnownUsernames(admin, creatorId),
    ]);
    const { groups, unreadable } = await groupUploadedFiles(files, knownUsernames);
    const analyzed = await analyzeLiveSessionGroups(admin, owner, creatorId, groups, tolerance);

    return { ok: true, sessions: analyzed.map(toPreview), unreadableFiles: unreadable };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

export async function saveLiveSessions(formData: FormData): Promise<SaveLiveSessionsResult> {
  try {
    const projectId = Number(formData.get("project_id"));
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    if (!projectId || !creatorId) throw new Error("Project & peserta wajib dipilih");

    const admin = createAdminClient();
    const actor = await requireProjectPerformanceAccess(admin, projectId);

    const brand = String(formData.get("brand") ?? "").trim() || null;
    const overridesRaw = String(formData.get("overrides") ?? "{}");
    let overrides: SessionOverrides = {};
    try {
      overrides = JSON.parse(overridesRaw);
    } catch {
      overrides = {};
    }

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Pilih minimal satu file untuk diunggah");

    const [owner, tolerance, knownUsernames] = await Promise.all([
      projectOwner(admin, projectId), getConfig<number>("m7.gmv_trend_tolerance"),
      loadKnownUsernames(admin, creatorId),
    ]);
    const { groups, unreadable } = await groupUploadedFiles(files, knownUsernames);
    const analyzed = await analyzeLiveSessionGroups(admin, owner, creatorId, groups, tolerance);

    const result = await persistLiveSessions(admin, owner, creatorId, analyzed, {
      actorId: actor.id, brand, overrides,
    });
    const skipped = [...unreadable.map((f) => ({ key: f.name, reason: f.reason })), ...result.skipped];

    for (const [i, sessionId] of result.savedSessionIds.entries()) {
      const key = result.saved[i];
      const a = analyzed.find((g) => g.group.key === key);
      await writeAudit({
        actorId: actor.id, action: "m7.live_session_upload", entityType: "project_live_sessions",
        entityId: String(sessionId),
        after: {
          uploader_id: actor.id, creator_id: creatorId, session_id: sessionId, project_id: projectId,
          checks_json: a?.checks ?? [], override_reason: overrides[key]?.reason ?? null,
        },
        type: "auto",
      });
    }

    for (const date of result.touchedDates) {
      await admin.rpc("recompute_creator_daily_live", { p: projectId, c: creatorId, d: date });
    }
    if (result.touchedDates.size > 0) {
      await admin.rpc("recompute_project_daily", { p: projectId });
      await admin.rpc("recompute_project_summary", { p: projectId });
      // Report yang sudah terbit harus ikut angka terbaru. Tanpa ini, sesi yang
      // diupload setelah report dibuat tidak pernah terlihat di halaman report
      // (temuan QA produksi 2026-09-17) — dan tim tidak punya cara tahu, karena
      // layarnya tetap menampilkan angka lama dengan yakin.
      await refreshCreatorReportDataSafe(admin, projectId, creatorId);
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/performa`);
    return { ok: result.saved.length > 0, saved: result.saved, skipped };
  } catch (e) {
    return { ok: false, saved: [], skipped: [], error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Batalkan sesi (PR-10): void + recompute so the numbers immediately drop out of the roll-up (R41). */
export async function voidLiveSession(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const sessionId = Number(formData.get("session_id"));
    if (!sessionId) throw new Error("Sesi tidak valid");

    const admin = createAdminClient();
    const { data: session, error: fetchError } = await admin
      .from("project_live_sessions")
      .select("id, project_id, creator_id, session_date, attribution_status")
      .eq("id", sessionId)
      .single();
    if (fetchError || !session) throw new Error("Sesi tidak ditemukan");
    if (!session.project_id) throw new Error("Sesi ini milik Jadwal Live — batalkan dari halaman jadwalnya.");
    // Hak akses dicek SETELAH sesinya diketahui, karena izinnya bisa datang dari
    // status man power di project sesi itu — bukan dari role global saja.
    const actor = await requireProjectPerformanceAccess(admin, session.project_id);

    const { error } = await admin
      .from("project_live_sessions")
      .update({ attribution_status: "voided", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (error) throw new Error(`Gagal membatalkan sesi: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "m7.live_session_void", entityType: "project_live_sessions",
      entityId: String(sessionId), before: { attribution_status: session.attribution_status },
      after: { attribution_status: "voided" }, type: "auto",
    });

    await admin.rpc("recompute_creator_daily_live", {
      p: session.project_id, c: session.creator_id, d: session.session_date,
    });
    await admin.rpc("recompute_project_daily", { p: session.project_id });
    await admin.rpc("recompute_project_summary", { p: session.project_id });
    // Membatalkan sesi mengurangi angka — report yang terbit tidak boleh tetap
    // memperlihatkan GMV yang sudah tidak dihitung lagi.
    await refreshCreatorReportDataSafe(admin, session.project_id, session.creator_id);

    revalidatePath(`/projects/${session.project_id}`);
    revalidatePath(`/projects/${session.project_id}/performa`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Sanggahan sesi (PRD §10.3/PR-26). A disputed session already dropped out of the
 * roll-up the moment `disputeLiveSession` (portal) flipped `attribution_status`
 * (view `project_creator_daily_live_v` filters to verified/confirmed_manual —
 * CLAUDE.md #4, same enforcement point as everywhere else in this table). These
 * two actions are how the team resolves it.
 */
async function recomputeAffected(
  admin: ReturnType<typeof createAdminClient>,
  entries: { projectId: number; creatorId: string; date: string }[]
) {
  const seenProjects = new Set<number>();
  for (const e of entries) {
    await admin.rpc("recompute_creator_daily_live", { p: e.projectId, c: e.creatorId, d: e.date });
    seenProjects.add(e.projectId);
  }
  for (const p of seenProjects) {
    await admin.rpc("recompute_project_daily", { p });
    await admin.rpc("recompute_project_summary", { p });
  }
  // Sanggahan yang ditolak atau sesi yang dipindahkan mengubah angka kedua
  // belah pihak — report yang sudah terbit ikut disegarkan, alasan yang sama
  // seperti pada upload dan pembatalan.
  for (const e of entries) {
    await refreshCreatorReportDataSafe(admin, e.projectId, e.creatorId);
  }
}

/** Tolak sanggahan → kembali `verified`, alasan tim dicatat (R41/§10.3). */
export async function rejectLiveSessionDispute(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const sessionId = Number(formData.get("session_id"));
    const reason = String(formData.get("reason") ?? "").trim();
    if (!sessionId) throw new Error("Sesi tidak valid");
    if (!reason) throw new Error("Alasan menolak sanggahan wajib diisi");

    const admin = createAdminClient();
    const { data: session } = await admin
      .from("project_live_sessions")
      .select("id, project_id, creator_id, session_date, attribution_status")
      .eq("id", sessionId).single();
    if (!session) throw new Error("Sesi tidak ditemukan");
    if (!session.project_id) throw new Error("Sesi ini milik Jadwal Live, bukan project");
    const actor = await requireProjectPerformanceAccess(admin, session.project_id);
    if (session.attribution_status !== "disputed") throw new Error("Sesi ini tidak sedang disanggah");

    const { error } = await admin
      .from("project_live_sessions")
      .update({
        attribution_status: "verified", attribution_note: `Sanggahan ditolak: ${reason}`,
        confirmed_by: actor.id, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: actor.id, action: "m7.live_session_dispute", entityType: "project_live_sessions",
      entityId: String(sessionId), before: { attribution_status: "disputed" },
      after: { attribution_status: "verified", reject_reason: reason }, type: "auto",
    });

    await recomputeAffected(admin, [{ projectId: session.project_id, creatorId: session.creator_id, date: session.session_date }]);

    revalidatePath(`/projects/${session.project_id}/performa`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Pindahkan sesi disanggah ke peserta lain — jalankan ulang V1-V7 untuk peserta
 * tujuan (§10.3). A block-level result refuses the move outright (the team should
 * void + re-upload manually instead); a warn-level result is allowed but the
 * session lands as `confirmed_manual`, same as a normal upload override.
 */
export async function reassignLiveSession(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const sessionId = Number(formData.get("session_id"));
    const targetCreatorId = String(formData.get("target_creator_id") ?? "").trim();
    if (!sessionId || !targetCreatorId) throw new Error("Sesi & peserta tujuan wajib dipilih");

    const admin = createAdminClient();
    const { data: session } = await admin
      .from("project_live_sessions")
      .select(
        "id, project_id, creator_id, session_date, session_no, start_time, end_time, gmv, gmv_trend, filename_product, attribution_status"
      )
      .eq("id", sessionId).single();
    if (!session) throw new Error("Sesi tidak ditemukan");
    if (!session.project_id) throw new Error("Sesi ini milik Jadwal Live, bukan project");
    const actor = await requireProjectPerformanceAccess(admin, session.project_id);
    if (session.attribution_status !== "disputed") throw new Error("Sesi ini tidak sedang disanggah");
    if (targetCreatorId === session.creator_id) throw new Error("Peserta tujuan sama dengan peserta saat ini");

    const parsedFilename = session.filename_product ? parseLiveFilename(session.filename_product) : null;
    if (!parsedFilename) {
      throw new Error("Nama file asli sesi ini tidak terbaca — tidak bisa dijalankan ulang V1, pindahkan manual (batalkan + upload ulang).");
    }

    const [{ data: project }, { data: targetCreator }, { data: aliasRows }, { data: existingRows }, tolerance] =
      await Promise.all([
        admin.from("special_projects").select("start_date, end_date").eq("id", session.project_id).single(),
        admin.from("creators").select("username").eq("id", targetCreatorId).single(),
        admin.from("creator_username_aliases").select("username").eq("creator_id", targetCreatorId),
        admin
          .from("project_live_sessions")
          .select("session_date, session_no, start_time, end_time")
          .eq("project_id", session.project_id).eq("creator_id", targetCreatorId)
          .neq("attribution_status", "voided"),
        getConfig<number>("m7.gmv_trend_tolerance"),
      ]);
    if (!project) throw new Error("Project tidak ditemukan");
    if (!targetCreator) throw new Error("Peserta tujuan tidak ditemukan");

    const existingSessions = (existingRows ?? []).map((s) => ({
      sessionDate: s.session_date, sessionNo: s.session_no, startTime: s.start_time, endTime: s.end_time,
    }));

    const checks = verifyLiveSession({
      selectedUsername: (targetCreator.username ?? "").toLowerCase(),
      aliasUsernames: (aliasRows ?? []).map((a) => a.username.toLowerCase()),
      filenameUsername: parsedFilename.username,
      sessionDate: session.session_date,
      projectStartDate: project.start_date,
      projectEndDate: project.end_date,
      sessionNo: session.session_no,
      existingSessions,
      newSession: { startTime: session.start_time, endTime: session.end_time },
      // Not a new file ingestion — moving ownership of an already-stored file, so
      // the V4 dedupe check (which exists to catch a file uploaded twice) doesn't apply.
      fileHashExists: false,
      hasProductFile: true,
      hasTrendFile: Boolean(session.filename_product),
      gmvProduct: session.gmv, gmvTrend: session.gmv_trend, gmvTrendTolerance: tolerance,
    });
    if (checks.some((c) => c.level === "block")) {
      const blockMsg = checks.find((c) => c.level === "block")!.message;
      throw new Error(`Tidak bisa dipindahkan ke peserta ini: ${blockMsg}`);
    }
    const attributionStatus = checks.some((c) => c.level === "warn") ? "confirmed_manual" : "verified";

    const { error } = await admin
      .from("project_live_sessions")
      .update({
        creator_id: targetCreatorId, attribution_status: attributionStatus,
        attribution_note: "Dipindahkan dari peserta lain (sanggahan)", confirmed_by: actor.id,
        confirmed_at: new Date().toISOString(), checks_json: checks, updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: actor.id, action: "m7.live_session_reassign", entityType: "project_live_sessions",
      entityId: String(sessionId),
      before: { creator_id: session.creator_id }, after: { creator_id: targetCreatorId, attribution_status: attributionStatus },
      type: "auto",
    });

    await recomputeAffected(admin, [
      { projectId: session.project_id, creatorId: session.creator_id, date: session.session_date },
      { projectId: session.project_id, creatorId: targetCreatorId, date: session.session_date },
    ]);

    revalidatePath(`/projects/${session.project_id}/performa`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

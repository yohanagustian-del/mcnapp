"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { parseLiveFilename, type ParsedLiveFilename } from "@/lib/m7/live-filename";
import { parseLiveProductFile, parseLiveTrendFile } from "@/lib/m7/live-parse";
import { verifyLiveSession, type ExistingSession, type VerifyResult } from "@/lib/m7/live-verify";

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
 */

export interface SessionGroupPreview {
  key: string;
  username: string;
  sessionNo: number;
  date: string;
  hasProductFile: boolean;
  hasTrendFile: boolean;
  gmv: number | null;
  gmvTrend: number | null;
  orders: number | null;
  startTime: string | null;
  endTime: string | null;
  checks: VerifyResult[];
  overallLevel: "ok" | "warn" | "block";
  /** Set when this group can't even be verified (e.g. no Product file at all). */
  blockedReason: string | null;
}

export type PreviewLiveSessionsResult =
  | { ok: true; sessions: SessionGroupPreview[]; unreadableFiles: string[] }
  | { ok: false; error: string };

export interface SaveLiveSessionsResult {
  ok: boolean;
  saved: string[]; // keys saved
  skipped: { key: string; reason: string }[];
  error?: string;
}

interface FileEntry {
  file: File;
  parsed: ParsedLiveFilename;
  hash: string;
}

interface SessionGroup {
  key: string;
  username: string;
  sessionNo: number;
  date: string;
  product?: FileEntry;
  trend?: FileEntry;
}

async function hashFile(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(buf).digest("hex");
}

async function groupUploadedFiles(
  files: File[]
): Promise<{ groups: SessionGroup[]; unreadable: string[] }> {
  const groups = new Map<string, SessionGroup>();
  const unreadable: string[] = [];
  for (const file of files) {
    const parsed = parseLiveFilename(file.name);
    if (!parsed) {
      unreadable.push(file.name);
      continue;
    }
    const hash = await hashFile(file);
    const key = `${parsed.username}|${parsed.sessionNo}|${parsed.date}`;
    const entry: SessionGroup =
      groups.get(key) ?? { key, username: parsed.username, sessionNo: parsed.sessionNo, date: parsed.date };
    if (parsed.kind === "product") entry.product = { file, parsed, hash };
    else entry.trend = { file, parsed, hash };
    groups.set(key, entry);
  }
  return { groups: [...groups.values()], unreadable };
}

/** First/last interval time → session start/end + duration (best-effort, same-day only). */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

interface AnalyzedGroup {
  group: SessionGroup;
  productResult: Awaited<ReturnType<typeof parseLiveProductFile>> | null;
  trendResult: Awaited<ReturnType<typeof parseLiveTrendFile>> | null;
  startTime: string | null;
  endTime: string | null;
  checks: VerifyResult[];
  overallLevel: "ok" | "warn" | "block";
  blockedReason: string | null;
}

async function analyzeGroups(
  admin: ReturnType<typeof createAdminClient>,
  projectId: number,
  creatorId: string,
  groups: SessionGroup[]
): Promise<AnalyzedGroup[]> {
  const [{ data: project }, { data: creator }, { data: aliasRows }, { data: existingRows }, tolerance] =
    await Promise.all([
      admin.from("special_projects").select("start_date, end_date").eq("id", projectId).single(),
      admin.from("creators").select("username").eq("id", creatorId).single(),
      admin.from("creator_username_aliases").select("username").eq("creator_id", creatorId),
      admin
        .from("project_live_sessions")
        .select("session_date, session_no, start_time, end_time")
        .eq("project_id", projectId)
        .eq("creator_id", creatorId)
        .neq("attribution_status", "voided"),
      getConfig<number>("m7.gmv_trend_tolerance"),
    ]);
  if (!project) throw new Error("Project tidak ditemukan");
  if (!creator) throw new Error("Kreator tidak ditemukan");

  const selectedUsername = (creator.username ?? "").toLowerCase();
  const aliasUsernames = (aliasRows ?? []).map((a) => a.username.toLowerCase());
  const existingSessions: ExistingSession[] = (existingRows ?? []).map((s) => ({
    sessionDate: s.session_date, sessionNo: s.session_no, startTime: s.start_time, endTime: s.end_time,
  }));

  // Phase 1: parse every group's content once (no verification yet) — a group with
  // no Product file at all can't be verified (no GMV source), so it's marked
  // block right away and excluded from the sibling-overlap pool below.
  interface Parsed {
    group: SessionGroup;
    productResult: Awaited<ReturnType<typeof parseLiveProductFile>> | null;
    trendResult: Awaited<ReturnType<typeof parseLiveTrendFile>> | null;
    startTime: string | null;
    endTime: string | null;
    fileHashExists: boolean;
  }
  const parsedGroups: Parsed[] = [];
  const blocked: AnalyzedGroup[] = [];

  for (const group of groups) {
    if (!group.product) {
      blocked.push({
        group, productResult: null, trendResult: null, startTime: null, endTime: null,
        checks: [], overallLevel: "block",
        blockedReason: "Butuh file Product untuk GMV sesi — Trend Stats saja tidak bisa disimpan.",
      });
      continue;
    }

    const productResult = await parseLiveProductFile(group.product.file);
    const trendResult = group.trend ? await parseLiveTrendFile(group.trend.file) : null;

    let startTime: string | null = null;
    let endTime: string | null = null;
    if (trendResult && trendResult.intervals.length > 0) {
      const times = trendResult.intervals.map((i) => i.time).filter((t) => toMinutes(t) !== null);
      if (times.length > 0) {
        startTime = times[0];
        endTime = times[times.length - 1];
      }
    }

    // V4 checks BOTH hash columns — a file could've been ingested as either kind before.
    const hashesToCheck = [group.product.hash, group.trend?.hash].filter((h): h is string => Boolean(h));
    let fileHashExists = false;
    for (const h of hashesToCheck) {
      const { count } = await admin
        .from("project_live_sessions")
        .select("id", { count: "exact", head: true })
        .or(`file_hash_product.eq.${h},file_hash_trend.eq.${h}`);
      if ((count ?? 0) > 0) { fileHashExists = true; break; }
    }

    parsedGroups.push({ group, productResult, trendResult, startTime, endTime, fileHashExists });
  }

  // Phase 2: verify each group against BOTH the DB's existing sessions AND its
  // siblings in this same batch (excluding itself) — two new sessions uploaded
  // together that overlap, or reuse a session number, must still be caught (V3/V7),
  // not just ones already saved from a previous upload.
  const analyzed: AnalyzedGroup[] = [...blocked];
  for (const p of parsedGroups) {
    const siblingSessions: ExistingSession[] = parsedGroups
      .filter((other) => other !== p)
      .map((other) => ({
        sessionDate: other.group.date, sessionNo: other.group.sessionNo,
        startTime: other.startTime, endTime: other.endTime,
      }));

    const checks = verifyLiveSession({
      selectedUsername,
      aliasUsernames,
      filenameUsername: p.group.username,
      sessionDate: p.group.date,
      projectStartDate: project.start_date,
      projectEndDate: project.end_date,
      sessionNo: p.group.sessionNo,
      existingSessions: [...existingSessions, ...siblingSessions],
      newSession: { startTime: p.startTime, endTime: p.endTime },
      fileHashExists: p.fileHashExists,
      hasProductFile: Boolean(p.group.product),
      hasTrendFile: Boolean(p.group.trend),
      gmvProduct: p.productResult!.totals.gmv,
      gmvTrend: p.trendResult?.totals.gmv ?? null,
      gmvTrendTolerance: tolerance,
    });

    const overallLevel: "ok" | "warn" | "block" = checks.some((c) => c.level === "block")
      ? "block"
      : checks.some((c) => c.level === "warn") ? "warn" : "ok";

    analyzed.push({
      group: p.group, productResult: p.productResult, trendResult: p.trendResult,
      startTime: p.startTime, endTime: p.endTime, checks, overallLevel, blockedReason: null,
    });
  }
  return analyzed;
}

export async function previewLiveSessions(formData: FormData): Promise<PreviewLiveSessionsResult> {
  try {
    await requirePermission("m7.metrics");
    const projectId = Number(formData.get("project_id"));
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    if (!projectId || !creatorId) throw new Error("Project & peserta wajib dipilih");

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Pilih minimal satu file untuk diunggah");

    const admin = createAdminClient();
    const { groups, unreadable } = await groupUploadedFiles(files);
    const analyzed = await analyzeGroups(admin, projectId, creatorId, groups);

    const sessions: SessionGroupPreview[] = analyzed.map((a) => ({
      key: a.group.key, username: a.group.username, sessionNo: a.group.sessionNo, date: a.group.date,
      hasProductFile: Boolean(a.group.product), hasTrendFile: Boolean(a.group.trend),
      gmv: a.productResult?.totals.gmv ?? null,
      gmvTrend: a.trendResult?.totals.gmv ?? null,
      orders: a.productResult?.totals.orders ?? null,
      startTime: a.startTime, endTime: a.endTime,
      checks: a.checks, overallLevel: a.overallLevel, blockedReason: a.blockedReason,
    }));

    return { ok: true, sessions, unreadableFiles: unreadable };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

export async function saveLiveSessions(formData: FormData): Promise<SaveLiveSessionsResult> {
  try {
    const actor = await requirePermission("m7.metrics");
    const projectId = Number(formData.get("project_id"));
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    if (!projectId || !creatorId) throw new Error("Project & peserta wajib dipilih");

    const brand = String(formData.get("brand") ?? "").trim() || null;
    const overridesRaw = String(formData.get("overrides") ?? "{}");
    let overrides: Record<string, { confirmed: boolean; reason: string }> = {};
    try {
      overrides = JSON.parse(overridesRaw);
    } catch {
      overrides = {};
    }

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Pilih minimal satu file untuk diunggah");

    const admin = createAdminClient();
    const { groups, unreadable } = await groupUploadedFiles(files);
    const analyzed = await analyzeGroups(admin, projectId, creatorId, groups);

    const saved: string[] = [];
    const skipped: { key: string; reason: string }[] = [];
    for (const f of unreadable) skipped.push({ key: f, reason: "Nama file tidak terbaca (§9 format)" });

    const touchedDates = new Set<string>();

    for (const a of analyzed) {
      if (a.overallLevel === "block") {
        skipped.push({
          key: a.group.key,
          reason: a.blockedReason ?? a.checks.find((c) => c.level === "block")?.message ?? "Gagal verifikasi",
        });
        continue;
      }
      const override = overrides[a.group.key];
      if (a.overallLevel === "warn" && !(override?.confirmed && override.reason.trim())) {
        skipped.push({ key: a.group.key, reason: "Butuh konfirmasi tim untuk peringatan (V5/V6) sebelum disimpan" });
        continue;
      }

      const attributionStatus = a.overallLevel === "warn" ? "confirmed_manual" : "verified";
      const totals = a.productResult!.totals;
      const orders = totals.orders;

      const { data: inserted, error } = await admin
        .from("project_live_sessions")
        .insert({
          project_id: projectId, creator_id: creatorId,
          session_date: a.group.date, session_no: a.group.sessionNo,
          brand,
          start_time: a.startTime, end_time: a.endTime,
          duration_min:
            a.startTime && a.endTime
              ? Math.max((toMinutes(a.endTime) ?? 0) - (toMinutes(a.startTime) ?? 0), 0)
              : null,
          gmv: totals.gmv,
          gmv_trend: a.trendResult?.totals.gmv ?? null,
          orders,
          items: totals.items,
          customers: totals.customers,
          views: a.trendResult?.totals.views ?? null,
          viewers_peak: a.trendResult?.totals.viewersPeak ?? null,
          product_impressions: totals.productImpressions,
          product_clicks: totals.productClicks,
          add_to_cart: totals.addedToCart,
          aov: orders > 0 ? totals.gmv / orders : null,
          attribution_status: attributionStatus,
          attribution_note: override?.reason ?? null,
          confirmed_by: override?.confirmed ? actor.id : null,
          confirmed_at: override?.confirmed ? new Date().toISOString() : null,
          checks_json: a.checks,
          filename_product: a.group.product?.file.name ?? null,
          filename_trend: a.group.trend?.file.name ?? null,
          file_hash_product: a.group.product?.hash ?? null,
          file_hash_trend: a.group.trend?.hash ?? null,
          uploaded_by: actor.id,
        })
        .select("id")
        .single();
      if (error) {
        skipped.push({ key: a.group.key, reason: `Gagal menyimpan: ${error.message}` });
        continue;
      }

      if (a.trendResult && a.trendResult.intervals.length > 0) {
        const { error: intervalError } = await admin.from("project_live_intervals").insert(
          a.trendResult.intervals.map((i) => ({
            session_id: inserted.id, time: i.time, gmv: i.gmv, orders: i.orders, items: i.items,
            views: i.views, viewers: i.viewers, product_impressions: i.productImpressions,
            product_clicks: i.productClicks, likes: i.likes, comments: i.comments, shares: i.shares,
            new_followers: i.newFollowers,
          }))
        );
        if (intervalError) {
          skipped.push({ key: a.group.key, reason: `Sesi tersimpan tapi timeline gagal: ${intervalError.message}` });
        }
      }

      await writeAudit({
        actorId: actor.id, action: "m7.live_session_upload", entityType: "project_live_sessions",
        entityId: String(inserted.id),
        after: {
          uploader_id: actor.id, creator_id: creatorId, session_id: inserted.id,
          checks_json: a.checks, override_reason: override?.reason ?? null,
        },
        type: "auto",
      });

      saved.push(a.group.key);
      touchedDates.add(a.group.date);
    }

    for (const date of touchedDates) {
      await admin.rpc("recompute_creator_daily_live", { p: projectId, c: creatorId, d: date });
    }
    if (touchedDates.size > 0) {
      await admin.rpc("recompute_project_daily", { p: projectId });
      await admin.rpc("recompute_project_summary", { p: projectId });
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/performa`);
    return { ok: saved.length > 0, saved, skipped };
  } catch (e) {
    return { ok: false, saved: [], skipped: [], error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Batalkan sesi (PR-10): void + recompute so the numbers immediately drop out of the roll-up (R41). */
export async function voidLiveSession(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const actor = await requirePermission("m7.metrics");
    const sessionId = Number(formData.get("session_id"));
    if (!sessionId) throw new Error("Sesi tidak valid");

    const admin = createAdminClient();
    const { data: session, error: fetchError } = await admin
      .from("project_live_sessions")
      .select("id, project_id, creator_id, session_date, attribution_status")
      .eq("id", sessionId)
      .single();
    if (fetchError || !session) throw new Error("Sesi tidak ditemukan");

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

    revalidatePath(`/projects/${session.project_id}`);
    revalidatePath(`/projects/${session.project_id}/performa`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

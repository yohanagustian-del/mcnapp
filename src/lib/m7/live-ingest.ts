/**
 * Inti upload sesi live TikTok LIVE Center — dipakai DUA pemilik sesi dengan
 * kode yang sama (CLAUDE.md #4: satu parser, satu verifikasi, satu penyimpanan):
 *
 *  - Special Project (M7 v2, `/projects/[id]/performa`): sesi milik project,
 *    kreator dipantau singkat selama project berjalan.
 *  - Jadwal Live (M13, `/schedule/live/[slotId]`): sesi milik satu slot jadwal,
 *    untuk kreator yang live rutin — OPSIONAL per slot, tidak semua jadwal
 *    wajib dibuatkan report.
 *
 * File yang diupload persis sama (Product + Trend Stats), pemeriksaan V1–V7
 * sama (lib/m7/live-verify.ts), tabelnya sama (`project_live_sessions` +
 * intervals + products, migrasi 0066: `project_id` XOR `schedule_slot_id`).
 * Yang berbeda hanya konteks pemilik — dan itu dijadikan parameter, bukan
 * salinan kode.
 *
 * Tidak ada RBAC di sini: pemanggil (server action) yang memutuskan siapa boleh
 * mengunggah untuk pemilik mana, lalu memanggil fungsi-fungsi ini dengan
 * service-role client. Tidak ada LLM (CLAUDE.md #1).
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLiveFilename, type ParsedLiveFilename } from "./live-filename";
import { detectLiveFileKind, parseLiveProductFile, parseLiveTrendFile } from "./live-parse";
import { verifyLiveSession, type ExistingSession, type VerifyResult } from "./live-verify";

export type LiveSessionOwner =
  | { kind: "project"; projectId: number; startDate: string; endDate: string }
  | { kind: "slot"; slotId: number; scheduleDate: string };

export interface UnreadableFile {
  name: string;
  reason: string;
}

interface FileEntry {
  file: File;
  parsed: ParsedLiveFilename;
  hash: string;
}

export interface SessionGroup {
  key: string;
  username: string;
  sessionNo: number;
  date: string;
  product?: FileEntry;
  trend?: FileEntry;
}

export interface AnalyzedGroup {
  group: SessionGroup;
  productResult: Awaited<ReturnType<typeof parseLiveProductFile>> | null;
  trendResult: Awaited<ReturnType<typeof parseLiveTrendFile>> | null;
  startTime: string | null;
  endTime: string | null;
  checks: VerifyResult[];
  overallLevel: "ok" | "warn" | "block";
  blockedReason: string | null;
}

/** Ringkasan satu grup sesi untuk layar pratinjau (bentuk yang dikirim ke klien). */
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

export function toPreview(a: AnalyzedGroup): SessionGroupPreview {
  return {
    key: a.group.key, username: a.group.username, sessionNo: a.group.sessionNo, date: a.group.date,
    hasProductFile: Boolean(a.group.product), hasTrendFile: Boolean(a.group.trend),
    gmv: a.productResult?.totals.gmv ?? null,
    gmvTrend: a.trendResult?.totals.gmv ?? null,
    orders: a.productResult?.totals.orders ?? null,
    startTime: a.startTime, endTime: a.endTime,
    checks: a.checks, overallLevel: a.overallLevel, blockedReason: a.blockedReason,
  };
}

async function hashFile(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(buf).digest("hex");
}

/** First/last interval time → session start/end + duration (best-effort, same-day only). */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Tanggal ISO ± n hari (UTC, tanpa zona waktu lokal). */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Rentang tanggal V2 per pemilik. Project = periodenya. Slot jadwal = tanggal
 * slot ±1 hari: live yang mulai 23:30 sesuai jadwal tapi baru "resmi" jalan
 * 00:10 diekspor TikTok bertanggal hari berikutnya — itu bukan file kreator
 * lain. Lebih dari sehari selisihnya = salah slot, ditolak (CLAUDE.md #7:
 * jangan menebak).
 */
export function ownerDateWindow(owner: LiveSessionOwner): { start: string; end: string; label: string } {
  if (owner.kind === "project") {
    return { start: owner.startDate, end: owner.endDate, label: "periode project" };
  }
  return {
    start: shiftIsoDate(owner.scheduleDate, -1),
    end: shiftIsoDate(owner.scheduleDate, 1),
    label: "tanggal jadwal (±1 hari)",
  };
}

/**
 * Username aktif + alias kreator (lowercase) — kandidat untuk disambiguasi
 * nama file (lihat `knownUsernames` di live-filename.ts) supaya username yang
 * SENDIRI mengandung "_" (mis. "bang_dull111") tidak salah kepotong di
 * separator pertama. Dipanggil sebelum `groupUploadedFiles` karena peserta
 * sudah dipilih di form upload lebih dulu (R40) — `analyzeLiveSessionGroups`
 * di bawah query hal yang sama lagi untuk V1, sengaja: query tunggal per
 * kreator, murah, dan menjaga kedua fungsi tetap independen/testable.
 */
export async function loadKnownUsernames(admin: SupabaseClient, creatorId: string): Promise<string[]> {
  const [{ data: creator }, { data: aliasRows }] = await Promise.all([
    admin.from("creators").select("username").eq("id", creatorId).single(),
    admin.from("creator_username_aliases").select("username").eq("creator_id", creatorId),
  ]);
  return [creator?.username, ...(aliasRows ?? []).map((a) => a.username)].filter(
    (u): u is string => Boolean(u)
  );
}

/**
 * Kelompokkan file per (username, sesi, tanggal) dari NAMA file; jenis
 * Product vs Trend Stats dibaca dari ISI file (kolomnya), bukan namanya.
 */
export async function groupUploadedFiles(
  files: File[], knownUsernames: string[] = []
): Promise<{ groups: SessionGroup[]; unreadable: UnreadableFile[] }> {
  const groups = new Map<string, SessionGroup>();
  const unreadable: UnreadableFile[] = [];
  for (const file of files) {
    const parsed = parseLiveFilename(file.name, knownUsernames);
    if (!parsed) {
      unreadable.push({ name: file.name, reason: "Nama file tidak terbaca — butuh username, \"sesi\" + nomor, dan tanggal (§9)." });
      continue;
    }
    const kind = await detectLiveFileKind(file);
    if (!kind) {
      unreadable.push({ name: file.name, reason: "Isi file tidak cocok kolom Product maupun Trend Stats." });
      continue;
    }
    const hash = await hashFile(file);
    const key = `${parsed.username}|${parsed.sessionNo}|${parsed.date}`;
    const entry: SessionGroup =
      groups.get(key) ?? { key, username: parsed.username, sessionNo: parsed.sessionNo, date: parsed.date };
    if (kind === "product") entry.product = { file, parsed, hash };
    else entry.trend = { file, parsed, hash };
    groups.set(key, entry);
  }
  return { groups: [...groups.values()], unreadable };
}

/** Sesi (masih hidup) yang memegang hash file yang sedang diunggah — isi pesan V4. */
type HashConflict = { projectId: number | null; slotId: number | null; sessionDate: string; sessionNo: number } | null;

/**
 * Sesi kreator yang sudah ada, untuk V3/V7. Project: sesi kreator di project
 * yang sama (perilaku M7 sejak awal). Slot jadwal: SEMUA sesi kreator yang
 * masih dihitung, pemilik mana pun — seorang kreator tidak bisa live dua kali
 * pada jam yang sama, dan nomor sesi pada tanggal yang sama merujuk live yang
 * sama, dari mana pun file itu diunggah.
 */
async function loadExistingSessions(
  admin: SupabaseClient,
  owner: LiveSessionOwner,
  creatorId: string
): Promise<ExistingSession[]> {
  let q = admin
    .from("project_live_sessions")
    .select("session_date, session_no, start_time, end_time")
    .eq("creator_id", creatorId)
    .neq("attribution_status", "voided");
  if (owner.kind === "project") q = q.eq("project_id", owner.projectId);
  const { data } = await q;
  return (data ?? []).map((s) => ({
    sessionDate: s.session_date, sessionNo: s.session_no, startTime: s.start_time, endTime: s.end_time,
  }));
}

export async function analyzeLiveSessionGroups(
  admin: SupabaseClient,
  owner: LiveSessionOwner,
  creatorId: string,
  groups: SessionGroup[],
  gmvTrendTolerance: number
): Promise<AnalyzedGroup[]> {
  const [{ data: creator }, { data: aliasRows }, existingSessions] = await Promise.all([
    admin.from("creators").select("username").eq("id", creatorId).single(),
    admin.from("creator_username_aliases").select("username").eq("creator_id", creatorId),
    loadExistingSessions(admin, owner, creatorId),
  ]);
  if (!creator) throw new Error("Kreator tidak ditemukan");

  const selectedUsername = (creator.username ?? "").toLowerCase();
  const aliasUsernames = (aliasRows ?? []).map((a) => a.username.toLowerCase());
  const window = ownerDateWindow(owner);

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
    fileHashConflict: HashConflict;
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

    // V4 checks BOTH hash columns — a file could've been ingested as either kind
    // before — across EVERY owner (project or schedule slot): one file is one live.
    const hashesToCheck = [group.product.hash, group.trend?.hash].filter((h): h is string => Boolean(h));
    let fileHashExists = false;
    let fileHashConflict: HashConflict = null;
    for (const h of hashesToCheck) {
      const { data: holders } = await admin
        .from("project_live_sessions")
        .select("project_id, schedule_slot_id, session_date, session_no, attribution_status")
        .or(`file_hash_product.eq.${h},file_hash_trend.eq.${h}`)
        .limit(10);
      // A voided session releases its files on purpose — "batalkan lalu upload
      // ulang" is the team's correction path (§10.3), and the unique indexes
      // carry the same rule since migration 0062. The status is filtered HERE,
      // in plain code, rather than as one more PostgREST operator stacked onto
      // the `or(...)`: this is the check that decides whether a re-upload is
      // possible at all, so it must be readable and testable on its own.
      const heldBy = (holders ?? []).find((r) => r.attribution_status !== "voided");
      if (heldBy) {
        fileHashExists = true;
        fileHashConflict = {
          projectId: heldBy.project_id ?? null, slotId: heldBy.schedule_slot_id ?? null,
          sessionDate: heldBy.session_date, sessionNo: heldBy.session_no,
        };
        break;
      }
    }

    parsedGroups.push({ group, productResult, trendResult, startTime, endTime, fileHashExists, fileHashConflict });
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
      projectStartDate: window.start,
      projectEndDate: window.end,
      periodLabel: window.label,
      sessionNo: p.group.sessionNo,
      existingSessions: [...existingSessions, ...siblingSessions],
      newSession: { startTime: p.startTime, endTime: p.endTime },
      fileHashExists: p.fileHashExists,
      fileHashConflict: p.fileHashConflict,
      hasProductFile: Boolean(p.group.product),
      hasTrendFile: Boolean(p.group.trend),
      gmvProduct: p.productResult!.totals.gmv,
      gmvTrend: p.trendResult?.totals.gmv ?? null,
      gmvTrendTolerance,
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

export type SessionOverrides = Record<string, { confirmed: boolean; reason: string }>;

export interface PersistResult {
  saved: string[];
  skipped: { key: string; reason: string }[];
  /** Tanggal sesi yang berhasil disimpan — pemanggil menjalankan recompute per tanggal. */
  touchedDates: Set<string>;
  savedSessionIds: number[];
}

/**
 * Simpan grup yang lolos (hijau, atau kuning yang dikonfirmasi tim). Sesi merah
 * tidak pernah disimpan. Menulis sesi + baris produk + interval; audit_logs
 * ditulis oleh pemanggil (yang tahu actor & konteksnya) — fungsi ini
 * mengembalikan id sesi tersimpan untuk itu.
 */
export async function persistLiveSessions(
  admin: SupabaseClient,
  owner: LiveSessionOwner,
  creatorId: string,
  analyzed: AnalyzedGroup[],
  opts: { actorId: string; brand: string | null; overrides: SessionOverrides }
): Promise<PersistResult> {
  const saved: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  const touchedDates = new Set<string>();
  const savedSessionIds: number[] = [];

  for (const a of analyzed) {
    if (a.overallLevel === "block") {
      skipped.push({
        key: a.group.key,
        reason: a.blockedReason ?? a.checks.find((c) => c.level === "block")?.message ?? "Gagal verifikasi",
      });
      continue;
    }
    const override = opts.overrides[a.group.key];
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
        project_id: owner.kind === "project" ? owner.projectId : null,
        schedule_slot_id: owner.kind === "slot" ? owner.slotId : null,
        creator_id: creatorId,
        session_date: a.group.date, session_no: a.group.sessionNo,
        brand: opts.brand,
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
        // First step of the report funnel (tayang → beli); only a total exists
        // (project_live_intervals has no per-interval impressions column).
        impressions_live: a.trendResult?.totals.impressions ?? null,
        product_impressions: totals.productImpressions,
        product_clicks: totals.productClicks,
        add_to_cart: totals.addedToCart,
        aov: orders > 0 ? totals.gmv / orders : null,
        attribution_status: attributionStatus,
        attribution_note: override?.reason ?? null,
        confirmed_by: override?.confirmed ? opts.actorId : null,
        confirmed_at: override?.confirmed ? new Date().toISOString() : null,
        checks_json: a.checks,
        filename_product: a.group.product?.file.name ?? null,
        filename_trend: a.group.trend?.file.name ?? null,
        file_hash_product: a.group.product?.hash ?? null,
        file_hash_trend: a.group.trend?.hash ?? null,
        uploaded_by: opts.actorId,
      })
      .select("id")
      .single();
    if (error) {
      skipped.push({ key: a.group.key, reason: `Gagal menyimpan: ${error.message}` });
      continue;
    }

    // Per-product rows (§9): the same file whose SUM became the session totals
    // above — kept so the report can tell the creator WHAT sold, not only how
    // much. Rows without a product id can't be keyed, so they're dropped here
    // (their numbers are already inside the session totals).
    const productRows = a.productResult!.rows.filter((r) => r.productId);
    if (productRows.length > 0) {
      const { error: productError } = await admin.from("project_live_session_products").insert(
        productRows.map((r) => ({
          session_id: inserted.id, product_id: r.productId, product_name: r.productName,
          gmv: r.gmv, items: r.items, orders: r.orders, customers: r.customers,
          product_impressions: r.productImpressions, product_clicks: r.productClicks,
          added_to_cart: r.addedToCart,
        }))
      );
      if (productError) {
        skipped.push({ key: a.group.key, reason: `Sesi tersimpan tapi rincian produk gagal: ${productError.message}` });
      }
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

    saved.push(a.group.key);
    savedSessionIds.push(inserted.id as number);
    touchedDates.add(a.group.date);
  }

  return { saved, skipped, touchedDates, savedSessionIds };
}

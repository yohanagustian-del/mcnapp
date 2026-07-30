import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";

/**
 * Daftar tunggu master kreator (migration 0028).
 *
 * Sejak insiden duplikat 2026-07-30, jalur upload data mingguan TIDAK LAGI membuat
 * baris `creators`. Username yang muncul di file tapi belum terdaftar juga tidak
 * boleh hilang tanpa jejak — ia dicatat di sini, lalu Akuisisi/Management/CM Lead
 * meng-approve (permission `creators.pending_review`) dan file mingguannya
 * di-upload ulang.
 *
 * Deterministik, 0 token AI.
 */

export type PendingSource =
  | "mcn_weekly"
  | "shopee_weekly"
  | "leak_artifact"
  | "leak_compute"
  | "deal_report";

export const PENDING_SOURCE_LABEL: Record<PendingSource, string> = {
  mcn_weekly: "Upload mingguan TikTok",
  shopee_weekly: "Upload mingguan Shopee",
  leak_artifact: "Upload artifak leak",
  leak_compute: "Analisa kebocoran link",
  deal_report: "Report sesi live deal",
};

/** Satu baris daftar tunggu apa adanya, untuk ditampilkan di panel akuisisi. */
export interface PendingRow {
  id: number;
  username: string;
  platform: string | null;
  source: string;
  status: string;
  seen_count: number;
  rows_affected: number | null;
  followers: number | null;
  gmv_snapshot: number | null;
  first_seen_at: string;
  last_seen_at: string;
  creator_id: string | null;
  review_note: string | null;
}

export interface RecordPendingInput {
  /** Username/nama yang tidak dapat di-resolve (apa adanya dari file). */
  usernames: string[];
  source: PendingSource;
  platform?: "tiktok" | "shopee" | null;
  batchId?: string | null;
  actorId?: string | null;
  /** Jumlah baris file yang dilewati per username (opsional, untuk prioritas review). */
  rowsByUsername?: Map<string, number>;
  /** Followers per username dari file (opsional, bantu akuisisi menilai). */
  followersByUsername?: Map<string, number>;
  /** GMV periode ini per username (opsional, informasi saja). */
  gmvByUsername?: Map<string, number>;
}

export interface RecordPendingResult {
  /** Username yang baru pertama kali masuk daftar tunggu. */
  created: string[];
  /** Username yang sudah pernah tercatat (seen_count dinaikkan). */
  bumped: string[];
  /** Username yang sudah pernah DITOLAK — tetap dilewati, tidak diangkat lagi. */
  rejected: string[];
}

/**
 * Catat/refresh username belum terdaftar ke daftar tunggu. Idempotent per
 * (lower(username), platform) — deteksi berulang menaikkan `seen_count` dan
 * memperbarui snapshot, tidak menumpuk baris (unique index `creator_pending_uidx`).
 *
 * Baris berstatus `rejected` DIBIARKAN rejected (bukan diangkat jadi pending lagi)
 * supaya salah tulis yang sudah diputuskan tidak muncul lagi tiap minggu —
 * counter-nya tetap naik, jadi kalau ternyata nyata masih kelihatan di filter.
 */
export async function recordPendingCreators(
  admin: SupabaseClient,
  input: RecordPendingInput
): Promise<RecordPendingResult> {
  const result: RecordPendingResult = { created: [], bumped: [], rejected: [] };

  const unique = [...new Set(input.usernames.map((u) => u.trim()).filter(Boolean))];
  if (unique.length === 0) return result;

  const platform = input.platform ?? null;
  const platformKey = platform ?? "tiktok";

  // Baris existing untuk username-username ini (filter di server; jumlahnya
  // sekecil daftar username, jadi tidak kena batas 1.000 baris PostgREST).
  const { data: existingRows, error } = await admin
    .from("creator_pending_registrations")
    .select("id, username, platform, status, seen_count")
    .in("username", unique);
  if (error) throw new Error(`Gagal membaca daftar tunggu kreator: ${error.message}`);

  const existingByKey = new Map<
    string,
    { id: number; status: string; seen_count: number }
  >();
  for (const r of existingRows ?? []) {
    const key = `${String(r.username).trim().toLowerCase()}|${(r.platform as string | null) ?? "tiktok"}`;
    existingByKey.set(key, {
      id: r.id as number,
      status: String(r.status),
      seen_count: Number(r.seen_count ?? 1),
    });
  }

  const now = new Date().toISOString();

  for (const username of unique) {
    const key = `${username.toLowerCase()}|${platformKey}`;
    const existing = existingByKey.get(key);
    const rows = input.rowsByUsername?.get(username.toLowerCase()) ?? null;
    const followers = input.followersByUsername?.get(username.toLowerCase()) ?? null;
    const gmv = input.gmvByUsername?.get(username.toLowerCase()) ?? null;

    if (existing) {
      const { error: updateError } = await admin
        .from("creator_pending_registrations")
        .update({
          seen_count: existing.seen_count + 1,
          last_seen_at: now,
          last_batch_id: input.batchId ?? null,
          rows_affected: rows,
          followers,
          gmv_snapshot: gmv,
          source: input.source,
        })
        .eq("id", existing.id);
      if (updateError) {
        throw new Error(`Gagal memperbarui daftar tunggu "${username}": ${updateError.message}`);
      }
      if (existing.status === "rejected") result.rejected.push(username);
      else result.bumped.push(username);
      continue;
    }

    const { error: insertError } = await admin.from("creator_pending_registrations").insert({
      username,
      platform,
      source: input.source,
      status: "pending",
      seen_count: 1,
      rows_affected: rows,
      followers,
      gmv_snapshot: gmv,
      first_seen_at: now,
      last_seen_at: now,
      first_batch_id: input.batchId ?? null,
      last_batch_id: input.batchId ?? null,
      detected_by: input.actorId ?? null,
    });
    if (insertError) {
      throw new Error(`Gagal mencatat daftar tunggu "${username}": ${insertError.message}`);
    }
    result.created.push(username);

    await writeAudit({
      actorId: input.actorId ?? undefined,
      action: "creator.pending_detected",
      entityType: "creator_pending_registrations",
      entityId: username,
      after: { username, platform, source: input.source, batch_id: input.batchId ?? null },
      type: "auto",
    });
  }

  return result;
}

/**
 * Kalimat siap tampil untuk laporan hasil upload — dipakai semua jalur ingest
 * supaya pesannya persis sama di /ingest, /link-leakage, dan report deal.
 */
export function pendingSkipReason(username: string, source: PendingSource): string {
  return (
    `Kreator "${username}" belum terdaftar di master → baris datanya DILEWATI dan ` +
    `masuk Daftar Tunggu Kreator (${PENDING_SOURCE_LABEL[source]}). ` +
    `Minta Akuisisi/CM Lead meng-approve di Acquisition Workspace, lalu upload ulang file ini.`
  );
}

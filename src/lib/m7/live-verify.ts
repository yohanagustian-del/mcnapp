/**
 * M7 v2 Special Project — live session upload verification (PRD §10.2, V1–V7).
 * Pure function: every fact (aliases, project period, existing sessions/hashes)
 * is supplied by the caller, who already fetched it from the DB — this file has
 * no I/O so the business rule can be unit-tested without a database.
 *
 * Brand/product consistency across sessions is deliberately NOT a check (§10
 * note: a creator switching products between live sessions is normal, not a
 * sign of the wrong creator) — never add it here.
 */

export type CheckLevel = "ok" | "warn" | "block";
export type CheckCode = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7";

export interface VerifyResult {
  level: CheckLevel;
  code: CheckCode;
  message: string;
}

export interface ExistingSession {
  sessionDate: string; // ISO yyyy-mm-dd
  sessionNo: number;
  startTime: string | null; // "HH:MM"
  endTime: string | null;
}

export interface LiveVerifyInput {
  /** Selected participant's active username + known aliases, all lowercase. */
  selectedUsername: string;
  aliasUsernames: string[];
  /** Username parsed from the uploaded filename, lowercase. */
  filenameUsername: string;
  sessionDate: string; // ISO yyyy-mm-dd
  projectStartDate: string;
  projectEndDate: string;
  sessionNo: number;
  /** This creator's other sessions in this project (the one being replaced, if any, excluded by the caller). */
  existingSessions: ExistingSession[];
  /** This session's own time range, once known from the Trend Stats file (null before it's uploaded). */
  newSession: { startTime: string | null; endTime: string | null };
  /** Whether this file's hash is already held by a LIVE (non-voided) session, in ANY project. */
  fileHashExists: boolean;
  /**
   * Which session still holds it, when one does — the V4 message names it and
   * says how to free the file. Without this the block reads "sudah pernah
   * diupload" and the team has no way to tell that cancelling that session is
   * exactly what unlocks the re-upload (temuan QA 2026-09-17).
   */
  fileHashConflict?: { projectId: number; sessionDate: string; sessionNo: number } | null;
  hasProductFile: boolean;
  hasTrendFile: boolean;
  gmvProduct: number | null;
  gmvTrend: number | null;
  /** app_config m7.gmv_trend_tolerance (e.g. 0.02 = 2%). */
  gmvTrendTolerance: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function timeRangesOverlap(
  a: { startTime: string | null; endTime: string | null },
  b: { startTime: string | null; endTime: string | null }
): boolean {
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return false;
  const [aStart, aEnd, bStart, bEnd] = [
    toMinutes(a.startTime), toMinutes(a.endTime), toMinutes(b.startTime), toMinutes(b.endTime),
  ];
  return aStart < bEnd && bStart < aEnd;
}

/** Runs V1–V7 and always returns exactly 7 results (one per code), 'ok' when a check doesn't apply. */
export function verifyLiveSession(input: LiveVerifyInput): VerifyResult[] {
  const results: VerifyResult[] = [];
  const sameDay = input.existingSessions.filter((s) => s.sessionDate === input.sessionDate);

  // V1: filename username must match the selected participant's active username or an alias.
  const validUsernames = new Set(
    [input.selectedUsername, ...input.aliasUsernames].map((u) => u.toLowerCase())
  );
  results.push(
    validUsernames.has(input.filenameUsername.toLowerCase())
      ? { level: "ok", code: "V1", message: "Username nama file cocok dengan peserta terpilih." }
      : {
          level: "block", code: "V1",
          message: `File ini bernama @${input.filenameUsername}, peserta yang dipilih @${input.selectedUsername}.`,
        }
  );

  // V2: session date within project period (R6).
  results.push(
    input.sessionDate >= input.projectStartDate && input.sessionDate <= input.projectEndDate
      ? { level: "ok", code: "V2", message: "Tanggal sesi dalam periode project." }
      : {
          level: "block", code: "V2",
          message: `Tanggal sesi (${input.sessionDate}) di luar periode project (${input.projectStartDate}–${input.projectEndDate}).`,
        }
  );

  // V3: no time overlap with another session, same creator, same day (R39).
  if (input.newSession.startTime === null || input.newSession.endTime === null) {
    results.push({ level: "ok", code: "V3", message: "Jam sesi belum diketahui — cek tumpang tindih dilewati." });
  } else if (sameDay.some((s) => timeRangesOverlap(input.newSession, s))) {
    results.push({
      level: "block", code: "V3",
      message: "Sesi ini tumpang tindih waktu dengan sesi lain kreator ini di hari yang sama — kemungkinan file milik kreator lain atau sesi duplikat.",
    });
  } else {
    results.push({ level: "ok", code: "V3", message: "Tidak ada tumpang tindih waktu dengan sesi lain di hari ini." });
  }

  // V4: file hash not already held by a live session, in any project. A voided
  // session releases its files on purpose — "batalkan lalu upload ulang" is the
  // team's correction path (§10.3), so the block says so instead of reading as
  // a dead end.
  const conflict = input.fileHashConflict;
  results.push(
    input.fileHashExists
      ? {
          level: "block", code: "V4",
          message: conflict
            ? `File ini sudah dipakai sesi aktif: project #${conflict.projectId}, ${conflict.sessionDate} sesi ${conflict.sessionNo}. ` +
              `Batalkan sesi itu dulu kalau memang mau upload ulang file yang sama.`
            : "File ini sudah dipakai sesi aktif yang lain (project mana pun). Batalkan sesi itu dulu kalau memang mau upload ulang file yang sama.",
        }
      : { level: "ok", code: "V4", message: "File belum dipakai sesi mana pun." }
  );

  // V5: Product + Trend Stats paired.
  results.push(
    input.hasProductFile && input.hasTrendFile
      ? { level: "ok", code: "V5", message: "Product dan Trend Stats berpasangan." }
      : {
          level: "warn", code: "V5",
          message: "Hanya salah satu file (Product/Trend Stats) diunggah — boleh disimpan tanpa timeline lengkap.",
        }
  );

  // V6: GMV Product vs Trend Stats within tolerance.
  if (input.gmvProduct !== null && input.gmvTrend !== null) {
    const diffRatio =
      input.gmvProduct > 0
        ? Math.abs(input.gmvProduct - input.gmvTrend) / input.gmvProduct
        : input.gmvTrend === 0 ? 0 : 1;
    results.push(
      diffRatio > input.gmvTrendTolerance
        ? {
            level: "warn", code: "V6",
            message: `Selisih GMV Product vs Trend Stats ${(diffRatio * 100).toFixed(1)}% melebihi toleransi ${(input.gmvTrendTolerance * 100).toFixed(0)}%.`,
          }
        : { level: "ok", code: "V6", message: "Selisih GMV Product vs Trend Stats dalam toleransi." }
    );
  } else {
    results.push({ level: "ok", code: "V6", message: "Selisih GMV tidak dicek (salah satu file belum ada)." });
  }

  // V7: session number not already used for this creator + date (R37).
  results.push(
    sameDay.some((s) => s.sessionNo === input.sessionNo)
      ? {
          level: "block", code: "V7",
          message: `Sesi ke-${input.sessionNo} untuk kreator ini di tanggal ${input.sessionDate} sudah ada — pilih "Ganti (replace)" untuk menimpanya.`,
        }
      : { level: "ok", code: "V7", message: "Nomor sesi belum ada untuk kreator & tanggal ini." }
  );

  return results;
}

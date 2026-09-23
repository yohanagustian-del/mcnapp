/**
 * Level kreator vs tabel TikTok Affiliate Level (L0-L8) — pure, deterministic.
 * Level TERSIMPAN (`creators.level`) tetap dari import (platform/sheet),
 * TIDAK PERNAH ditimpa oleh fungsi di sini (read-only, sama seperti
 * commission_share — CLAUDE.md #3). Fungsi ini hanya menghasilkan ESTIMASI
 * untuk badge peringatan di roster.
 *
 * Syarat resmi TikTok = GMV MTD DAN hari aktif MTD. Hari aktif tidak ada di
 * data platform yang diingest (agregat per periode, bukan per hari) — jadi
 * estimasi di sini HANYA dari GMV MTD, dan karena itu adalah BATAS ATAS
 * (upper bound): kreator bisa jadi belum capai level itu karena hari aktifnya
 * kurang, tapi tidak mungkin lebih tinggi dari yang GMV-nya izinkan.
 *
 * L0 dan L1 sama-sama minGmv=0 (tidak bisa dibedakan lewat GMV) — estimasi
 * pada kasus itu dilabeli "≤L1", bukan diklaim tepat L1.
 */

export interface AffiliateLevelRule {
  level: number;
  minActiveDays: number;
  minGmv: number;
}

/** Level tertinggi dengan gmvMtd >= minGmv rule tersebut (batas atas, lihat catatan file). */
export function gmvLevelEstimate(gmvMtd: number, table: AffiliateLevelRule[]): number {
  const sorted = [...table].sort((a, b) => a.level - b.level);
  let best = sorted[0]?.level ?? 0;
  for (const rule of sorted) {
    if (gmvMtd >= rule.minGmv) best = rule.level;
  }
  return best;
}

/** Label tampil: L0/L1 (minGmv sama-sama 0, tak terbedakan) dibaca "≤L1"; selainnya "L{n}". */
export function estimateLabel(estimate: number): string {
  return estimate <= 1 ? "≤L1" : `L${estimate}`;
}

export interface LevelMismatch {
  /** true bila level tersimpan (import) LEBIH RENDAH dari estimasi GMV — data platform lebih tinggi. */
  mismatched: boolean;
  imported: number | null;
  estimate: number;
}

/**
 * Bandingkan level tersimpan vs estimasi GMV. Hanya menandai mismatch saat
 * imported < estimate (platform "lebih maju" dari data sheet) — imported yang
 * LEBIH TINGGI dari estimasi bukan mismatch (estimasi cuma batas atas dari
 * satu syarat, bukan nilai pasti).
 */
export function levelMismatch(imported: number | null, estimate: number): LevelMismatch {
  return { mismatched: imported != null && imported < estimate, imported, estimate };
}

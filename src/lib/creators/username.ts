/**
 * Pencocokan kreator lewat USERNAME (identitas akun platform), bukan `creators.id`.
 * Dipakai form yang diisi manusia — orang hafal "vikahere", bukan "CRT-8f21c".
 *
 * Aturannya sama dengan pendaftaran kreator manual (create-actions.ts): username
 * dicocokkan case-insensitive karena "Winris12" dan "winris12" adalah akun yang sama
 * di platform. Logikanya murni di sini supaya bisa diuji tanpa DB.
 */

/** Username yang diketik user: buang "@" di depan dan spasi di ujung. */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, "").trim();
}

/**
 * Pola `ilike` untuk mencari username. `_` dan `%` adalah wildcard LIKE dan lazim ada
 * di username ("yr_ofc"), jadi di-escape dulu — hasilnya tetap harus diverifikasi
 * dengan `pickExactUsername` supaya tidak ada kecocokan semu.
 */
export function likePatternForUsername(username: string): string {
  return username.replace(/([\\%_])/g, "\\$1");
}

/**
 * Ambil baris yang usernamenya benar-benar sama (case-insensitive), bukan sekadar mirip.
 * Baris tanpa username tidak pernah cocok — termasuk saat yang dicari kebetulan kosong.
 */
export function pickExactUsername<T extends { username: string | null }>(
  rows: T[],
  username: string
): T | null {
  const target = username.toLowerCase();
  if (!target) return null;
  return rows.find((r) => r.username != null && r.username.toLowerCase() === target) ?? null;
}

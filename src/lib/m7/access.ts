import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Hak kelola peserta project (M7 §2.5) — dua jalur, bukan satu permission global:
 *
 *  1. Role dengan `m7.manage` (management + lead + campaign_ops): boleh untuk SEMUA
 *     project, termasuk meng-assign man power in-charge.
 *  2. Anggota tim yang sudah di-ASSIGN sebagai man power di project itu: boleh
 *     menambah peserta di project tersebut saja, meski role globalnya tidak punya
 *     `m7.manage`. Assignment-nya sendiri tetap keputusan pemegang `m7.manage`.
 *
 * Ini fungsi murni supaya aturannya bisa diuji tanpa DB; pemanggil menyuplai kedua
 * fakta dari sumbernya masing-masing (PERMISSIONS + tabel project_manpower).
 */
export function canManageProjectParticipants({
  hasManagePermission,
  isAssignedManpower,
}: {
  hasManagePermission: boolean;
  isAssignedManpower: boolean;
}): boolean {
  return hasManagePermission || isAssignedManpower;
}

/**
 * Hak unggah performa project (upload sesi live, pembatalan, penyelesaian
 * sanggahan) — dua jalur yang SAMA dengan hak kelola peserta di atas:
 *
 *  1. Role dengan `m7.metrics`: boleh untuk SEMUA project.
 *  2. Anggota tim yang di-ASSIGN sebagai man power di project itu: boleh untuk
 *     project tersebut saja.
 *
 * Jalur kedua ditambahkan setelah temuan lapangan 2026-09-17: dua CPM di-assign
 * sebagai man power project, sudah bisa mengisi pesertanya, tapi tidak bisa
 * mengunggah data sesi peserta yang sama — padahal merekalah yang menjalankan
 * project itu sehari-hari. "Boleh mengisi peserta tapi tidak boleh mengisi
 * datanya" bukan pembatasan yang disengaja, cuma satu jalur yang belum ikut
 * diperluas. Assignment-nya sendiri tetap keputusan pemegang `m7.manage`, jadi
 * siapa yang dapat akses ini tetap terkendali.
 */
export function canUploadProjectPerformance({
  hasMetricsPermission,
  isAssignedManpower,
}: {
  hasMetricsPermission: boolean;
  isAssignedManpower: boolean;
}): boolean {
  return hasMetricsPermission || isAssignedManpower;
}

/** Apakah `memberId` terdaftar sebagai man power in-charge project ini. */
export async function isAssignedManpower(
  supabase: SupabaseClient,
  projectId: number,
  memberId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("project_manpower")
    .select("member_id")
    .eq("project_id", projectId)
    .eq("member_id", memberId)
    .maybeSingle();
  return Boolean(data);
}

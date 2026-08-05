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

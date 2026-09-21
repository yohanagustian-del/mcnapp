import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMember } from "@/lib/rbac";

/**
 * Scope guard Jadwal Live: a `cpm` may only touch slots (and live data) of
 * creators they own (creators.owner_cpm_id = member.id). Every other permitted
 * role has full scope. Throws (Bahasa Indonesia) on violation.
 *
 * Dipakai server action slot (schedule/actions.ts) DAN server action data live
 * per slot (schedule/live/[slotId]/actions.ts) — satu definisi, bukan dua.
 */
export async function assertCreatorInScope(
  admin: SupabaseClient,
  member: TeamMember,
  creatorId: string
): Promise<void> {
  const { data, error } = await admin
    .from("creators")
    .select("id, live_roster, owner_cpm_id")
    .eq("id", creatorId)
    .maybeSingle();
  if (error) throw new Error(`Gagal memeriksa kreator: ${error.message}`);
  if (!data) throw new Error("Kreator tidak ditemukan.");
  if (member.role === "cpm" && data.owner_cpm_id !== member.id) {
    throw new Error("Akses ditolak: CPM hanya boleh mengubah jadwal kreator yang dipegangnya.");
  }
}

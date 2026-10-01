import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMember } from "@/lib/rbac";

/**
 * Pure scope rule behind assertCreatorInScope: a `cpm` only has scope over
 * creators they own (creators.owner_cpm_id = member.id); every other permitted
 * role has full scope. Exported so pages can hide out-of-scope actions with the
 * exact rule the server enforces (one definition, not two).
 */
export function isCreatorInScope(
  member: Pick<TeamMember, "id" | "role">,
  ownerCpmId: string | null | undefined
): boolean {
  return member.role !== "cpm" || ownerCpmId === member.id;
}

/**
 * Scope guard Jadwal Live: a `cpm` may only touch slots (and live data) of
 * creators they own (creators.owner_cpm_id = member.id). Every other permitted
 * role has full scope. Throws (Bahasa Indonesia) on violation.
 *
 * Dipakai server action slot (schedule/actions.ts) DAN server action data live
 * per slot (schedule/live/[slotId]/actions.ts) — satu definisi, bukan dua.
 * Also used by the Creator Portal invite (lib/portal/invite.ts): `action` is the
 * verb phrase in the error message; the default keeps the schedule text as-is.
 */
export async function assertCreatorInScope(
  admin: SupabaseClient,
  member: TeamMember,
  creatorId: string,
  action = "mengubah jadwal"
): Promise<void> {
  const { data, error } = await admin
    .from("creators")
    .select("id, live_roster, owner_cpm_id")
    .eq("id", creatorId)
    .maybeSingle();
  if (error) throw new Error(`Gagal memeriksa kreator: ${error.message}`);
  if (!data) throw new Error("Kreator tidak ditemukan.");
  if (!isCreatorInScope(member, data.owner_cpm_id)) {
    throw new Error(`Akses ditolak: CPM hanya boleh ${action} kreator yang dipegangnya.`);
  }
}

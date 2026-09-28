"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCreatorInScope } from "@/lib/schedule/scope";
import { renewCreatorContract } from "@/lib/creators/contract-renewal";

/**
 * PLAN_MSDPS_mcnapp.md Paket D (R5): perpanjangan kontrak dari halaman Perpanjangan
 * Kreator. Sama seperti server actions lain di repo ini, TIDAK PERNAH throw — Next.js
 * menyensor pesan error server action di production.
 */
export type RenewActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function renewContractAction(formData: FormData): Promise<RenewActionResult> {
  try {
    const member = await requirePermission("creators.contract_renew");
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    const startDate = String(formData.get("start_date") ?? "").trim();
    const endDate = String(formData.get("end_date") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!creatorId) return { ok: false, error: "Kreator wajib dipilih." };

    // Q7: Akuisisi/Management lintas kreator; CM/CPM dibatasi ke kreator dalam scope-nya
    // (pola sama Jadwal Live — CLAUDE.md #4, satu fungsi scope, bukan salinan kedua).
    const admin = createAdminClient();
    await assertCreatorInScope(admin, member, creatorId);

    const result = await renewCreatorContract(admin, {
      creatorId, startDate, endDate, notes, actorId: member.id, kind: "perpanjangan",
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath("/workspace/acquisition/perpanjangan");
    revalidatePath("/creators");
    return { ok: true, message: "Kontrak berhasil diperpanjang." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

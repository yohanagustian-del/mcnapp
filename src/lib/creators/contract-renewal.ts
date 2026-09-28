// PLAN_MSDPS_mcnapp.md Paket D (R5): satu engine untuk memperpanjang kontrak kreator —
// dipakai /workspace/acquisition/perpanjangan (baru) DAN registerCreator's re-register
// path (workspace/acquisition/actions.ts, existing, sebelumnya UPDATE sendiri).
// CLAUDE.md #4: creators.contract_end_date sejak migrasi 0075 HANYA ditulis dari sini.

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";

export type CreatorStatus = "prospek" | "binding" | "aktif" | "nonaktif";

export interface RenewCreatorContractParams {
  creatorId: string;
  /** New contract period start (YYYY-MM-DD). */
  startDate: string;
  /** New contract period end == new creators.contract_end_date (YYYY-MM-DD). */
  endDate: string;
  notes?: string | null;
  /** team_members.id — created_by on the period row + audit actor. */
  actorId: string;
  kind?: "baru" | "perpanjangan";
  /**
   * Explicit status to set after renewal (registerCreator keeps its own 'binding').
   * Omit to apply the default Q7 rule: nonaktif -> aktif, otherwise unchanged.
   */
  status?: CreatorStatus;
}

export type RenewCreatorContractResult =
  | { ok: true; periodId: number }
  | { ok: false; error: string };

/**
 * Validasi (Q8, disetujui pemilik 2026-09-28): end_date > start_date wajib.
 * start_date harus SETELAH akhir periode kontrak sebelumnya (kalau ada) — jeda antar
 * periode diperbolehkan dan tercatat apa adanya (notes); yang ditolak hanya overlap
 * (start_date <= akhir periode lama, yang akan membuat dua periode tumpang tindih).
 */
export async function renewCreatorContract(
  admin: SupabaseClient,
  params: RenewCreatorContractParams
): Promise<RenewCreatorContractResult> {
  const { creatorId, startDate, endDate, notes = null, actorId, kind = "perpanjangan" } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { ok: false, error: "Format tanggal tidak valid (YYYY-MM-DD)." };
  }
  if (endDate <= startDate) {
    return { ok: false, error: "Tanggal akhir kontrak harus setelah tanggal mulai." };
  }

  const { data: creator, error: creatorErr } = await admin
    .from("creators")
    .select("id, name, status, contract_end_date")
    .eq("id", creatorId)
    .maybeSingle();
  if (creatorErr) return { ok: false, error: `Gagal membaca kreator: ${creatorErr.message}` };
  if (!creator) return { ok: false, error: "Kreator tidak ditemukan." };

  const { data: latestPeriod, error: latestErr } = await admin
    .from("creator_contract_periods")
    .select("end_date")
    .eq("creator_id", creatorId)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) return { ok: false, error: `Gagal membaca riwayat kontrak: ${latestErr.message}` };
  if (latestPeriod && startDate <= (latestPeriod.end_date as string)) {
    return {
      ok: false,
      error: `Tanggal mulai (${startDate}) harus setelah akhir periode kontrak sebelumnya (${latestPeriod.end_date}) — periode tidak boleh tumpang tindih.`,
    };
  }

  const { data: period, error: insertErr } = await admin
    .from("creator_contract_periods")
    .insert({
      creator_id: creatorId, start_date: startDate, end_date: endDate, kind, notes, created_by: actorId,
    })
    .select("id")
    .single();
  if (insertErr) return { ok: false, error: `Gagal mencatat periode kontrak: ${insertErr.message}` };

  // Q7: kreator nonaktif yang diperpanjang kembali aktif. Status lain (registerCreator
  // memaksa 'binding') dipakai apa adanya lewat parameter `status`.
  const nextStatus: CreatorStatus =
    params.status ?? (creator.status === "nonaktif" ? "aktif" : (creator.status as CreatorStatus));

  const before = { contract_end_date: creator.contract_end_date, status: creator.status };
  const { error: updateErr } = await admin
    .from("creators")
    .update({ contract_end_date: endDate, status: nextStatus })
    .eq("id", creatorId);
  if (updateErr) return { ok: false, error: `Gagal memperbarui kreator: ${updateErr.message}` };

  await writeAudit({
    actorId,
    action: "m8.creator_contract_renew",
    entityType: "creators",
    entityId: creatorId,
    before,
    after: { contract_end_date: endDate, status: nextStatus, period_id: period.id, kind },
    // Perpanjangan kontrak = menambah income, tidak merugikan → auto berlaku (CLAUDE.md #2).
    type: "auto",
  });

  return { ok: true, periodId: period.id as number };
}

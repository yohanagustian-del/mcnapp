// Bagian SERVER-ONLY dari kontrak kreator (PLAN_MSDPS Paket D) — terpisah dari
// contract.ts supaya komponen klien (creators-table.tsx) tidak ikut membundel
// Supabase server client / next/headers hanya karena mengimpor tipe/fungsi murni.

import { getConfig } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayWib } from "@/lib/utils/date";
import { DEFAULT_CONTRACT_ALERT_DAYS, type ContractAlertDays } from "./contract";

export async function loadContractAlertDays(): Promise<ContractAlertDays> {
  return getConfig<ContractAlertDays>("m8.contract_alert_days");
}

/**
 * Badge sidebar "Perpanjangan Kreator" (D-04): kreator dengan kontrak habis atau
 * ≤ ambang danger, dihitung saat render — pola sama pic-tap-alerts.ts, tanpa tabel
 * alert baru. `scopeCpmId` membatasi ke kreator milik satu CPM (null = semua).
 */
export async function countExpiringContracts(scopeCpmId: string | null): Promise<number> {
  const admin = createAdminClient();
  const alertDays = await loadContractAlertDays().catch(() => DEFAULT_CONTRACT_ALERT_DAYS);
  const cutoff = new Date(Date.parse(`${todayWib()}T00:00:00Z`) + alertDays.danger * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let query = admin
    .from("creators")
    .select("id", { count: "exact", head: true })
    .not("contract_end_date", "is", null)
    .lte("contract_end_date", cutoff);
  if (scopeCpmId) query = query.eq("owner_cpm_id", scopeCpmId);

  const { count } = await query;
  return count ?? 0;
}

import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { contractDays } from "@/lib/creators/contract";
import { loadContractAlertDays } from "@/lib/creators/contract-alerts";
import { PerpanjanganTable, type PerpanjanganRow } from "./perpanjangan-table";

export const dynamic = "force-dynamic";

interface CreatorRow {
  id: string;
  name: string;
  username: string | null;
  owner_cpm_id: string | null;
  join_date: string | null;
  contract_end_date: string | null;
  team_members: { name?: string } | null;
}

interface PeriodRow {
  creator_id: string;
}

/**
 * PLAN_MSDPS_mcnapp.md Paket D (R5): "Perpanjangan Kreator" — countdown kontrak +
 * form perpanjangan, satu jalur lewat renewCreatorContract() (CLAUDE.md #4).
 */
export default async function PerpanjanganKreatorPage() {
  const member = await requireMember();
  if (!hasPermission("creators.contract_renew", member.role)) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Akses ditolak — role Anda tidak memiliki izin memperpanjang kontrak kreator.
      </div>
    );
  }

  const alertDays = await loadContractAlertDays();
  const supabase = await createClient();
  const isCpm = member.role === "cpm";

  const creators = await fetchAll<CreatorRow>(
    supabase,
    "creators",
    "id, name, username, owner_cpm_id, join_date, contract_end_date, team_members!creators_owner_cpm_id_fkey(name)",
    (q) => (isCpm ? q.eq("owner_cpm_id", member.id) : q)
  );

  const creatorIds = creators.map((c) => c.id);
  const periods = creatorIds.length
    ? await fetchAll<PeriodRow>(supabase, "creator_contract_periods", "creator_id", (q) =>
        q.in("creator_id", creatorIds)
      )
    : [];
  const priorCounts = new Map<string, number>();
  for (const p of periods) priorCounts.set(p.creator_id, (priorCounts.get(p.creator_id) ?? 0) + 1);

  const nowMs = Date.now();
  const rows: PerpanjanganRow[] = creators.map((c) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    cmName: c.team_members?.name ?? null,
    joinDate: c.join_date,
    contractEndDate: c.contract_end_date,
    days: contractDays(c.join_date, c.contract_end_date, nowMs),
    priorPeriods: priorCounts.get(c.id) ?? 0,
  }));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Perpanjangan Kreator</h1>
      <p className="mt-1 text-sm text-slate-500">
        Countdown kontrak kreator{isCpm ? " yang Anda pegang" : ""} — merah = ≤{alertDays.danger} hari atau sudah
        habis, kuning = ≤{alertDays.warning} hari.
      </p>
      <div className="mt-4">
        <PerpanjanganTable rows={rows} />
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import type { ExternalApproachRow } from "@/lib/workspace/external-approach";
import { ApproachCreateModal } from "./approach-create-modal";
import { ApproachTable } from "./approach-table";
import { ApproachScorecards } from "./approach-scorecards";

export const dynamic = "force-dynamic";

export default async function ExternalWorkspacePage() {
  const member = await requireMember();
  const canRecord = hasPermission("m8.external", member.role);

  const supabase = await createClient();
  const { data: approaches } = await supabase
    .from("external_approaches")
    .select(
      "id, creator_name, creator_id, brand, niche, platform, followers, wa_contact, gmv, channel, approach_date, reachout_date, respon_date, follow_up_1_date, follow_up_2_date, follow_up_3_date, using_tap_date, prove_link, notes, team_members(name)"
    )
    .order("id", { ascending: false })
    .limit(1000);

  const rows: ExternalApproachRow[] = (approaches ?? []).map((a) => {
    const { team_members, ...rest } = a as typeof a & { team_members: { name?: string } | null };
    return { ...rest, approached_by_name: team_members?.name ?? null };
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">External Creator Workspace (M8)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pipeline scouting creator external: dari scouting sampai using TAP. Status link per
          creator ter-binding di-surface dari M4 — tidak dihitung ulang. 0 token AI.
        </p>
      </div>

      <ApproachScorecards rows={rows} />

      {canRecord && (
        <section>
          <h2 className="text-lg font-medium">Input Data</h2>
          <div className="mt-3">
            <ApproachCreateModal />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium">Daftar Approach</h2>
        <ApproachTable rows={rows} canEdit={canRecord} />
        <p className="mt-2 text-xs text-slate-500">
          Creator external yang perform → kandidat binding (koordinasi Akuisisi, §2D.2). Detail
          leakage & link per creator ada di <Link href="/link-leakage" className="underline">Link Leakage (M4)</Link>.
        </p>
      </section>
    </div>
  );
}

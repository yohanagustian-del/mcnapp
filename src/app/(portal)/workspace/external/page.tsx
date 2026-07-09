import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { successRate } from "@/lib/m8/routing";
import { recordApproach, updateApproachStatus } from "./actions";

export const dynamic = "force-dynamic";

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700";
const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

export default async function ExternalWorkspacePage() {
  const member = await requireMember();
  const canRecord = hasPermission("m8.external", member.role);

  const supabase = await createClient();
  const { data: approaches } = await supabase
    .from("external_approaches")
    .select("id, creator_name, creator_id, approach_date, status, notes, team_members(name)")
    .order("id", { ascending: false })
    .limit(200);

  // §2D.1: approach → success (deal pakai link TAP) → GMV creator terkait.
  const total = (approaches ?? []).length;
  const success = (approaches ?? []).filter((a) => a.status === "pakai_link").length;
  const rate = successRate(total, success);

  const linkedIds = [...new Set((approaches ?? []).map((a) => a.creator_id).filter(Boolean))] as string[];
  const [{ data: linkedCreators }, { data: links }] = await Promise.all([
    linkedIds.length
      ? supabase.from("creators").select("id, name, gmv, level, segment, status").in("id", linkedIds)
      : Promise.resolve({ data: [] as { id: string; name: string; gmv: number | null; level: number | null; segment: string | null; status: string }[] }),
    linkedIds.length
      ? supabase
          .from("agency_links")
          .select("creator_id, link_status")
          .in("creator_id", linkedIds)
          .eq("link_status", "via_agency")
      : Promise.resolve({ data: [] as { creator_id: string; link_status: string }[] }),
  ]);
  const totalGmv = (linkedCreators ?? []).reduce((s, c) => s + Number(c.gmv ?? 0), 0);
  const viaAgencyByCreator = new Map<string, number>();
  for (const l of links ?? []) {
    viaAgencyByCreator.set(l.creator_id, (viaAgencyByCreator.get(l.creator_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">External Creator Workspace (M8)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Metrik approach, success rate (deal pakai link TAP), dan GMV creator external. Status link
          per creator di-surface dari M4 — tidak dihitung ulang. 0 token AI.
        </p>
      </div>

      {/* ===== §2D.1 metrik ===== */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Creator di-approach</p>
          <p className="mt-1 text-2xl font-semibold">{total}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Success rate (pakai link TAP)</p>
          <p className="mt-1 text-2xl font-semibold">{rate === null ? "—" : `${(rate * 100).toFixed(0)}%`}</p>
          <p className="text-sm text-slate-500">{success} dari {total} approach</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Total GMV creator ter-link</p>
          <p className="mt-1 text-2xl font-semibold">{rupiah(totalGmv)}</p>
          <p className="text-sm text-slate-500">{linkedIds.length} creator terdaftar</p>
        </div>
      </section>

      {canRecord && (
        <section>
          <h2 className="text-lg font-medium">Catat Approach</h2>
          <form action={recordApproach} className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <input name="creator_name" required placeholder="Nama creator" className={input} />
            <input name="creator_id" placeholder="Creator ID (CRT-..., bila terdaftar)" className={input} />
            <input name="notes" placeholder="Catatan" className={input} />
            <button type="submit" className={btn}>Catat</button>
          </form>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium">Daftar Approach</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Creator</th><th className="px-4 py-3">Tanggal</th>
                <th className="px-4 py-3">Oleh</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Link via agency (M4)</th><th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(approaches ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2 font-medium">{a.creator_name} {a.creator_id && <span className="text-xs text-slate-400">{a.creator_id}</span>}</td>
                  <td className="px-4 py-2">{a.approach_date}</td>
                  <td className="px-4 py-2">{(a.team_members as unknown as { name?: string } | null)?.name ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.status === "pakai_link" ? "bg-green-100 text-green-800"
                      : a.status === "batal" ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {a.creator_id ? `${viaAgencyByCreator.get(a.creator_id) ?? 0} link` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {canRecord && a.status === "approach" && (
                      <div className="flex gap-1">
                        {(["pakai_link", "batal"] as const).map((s) => (
                          <form key={s} action={updateApproachStatus}>
                            <input type="hidden" name="approach_id" value={a.id} />
                            <input type="hidden" name="status" value={s} />
                            <button type="submit" className={`${btnSmall} ${s === "pakai_link" ? "bg-green-600 text-white" : "bg-slate-200 text-slate-700"}`}>
                              {s === "pakai_link" ? "Deal pakai link" : "Batal"}
                            </button>
                          </form>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {(approaches ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Belum ada approach tercatat.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Creator external yang perform → kandidat binding (koordinasi Akuisisi, §2D.2). Detail
          leakage & link per creator ada di <Link href="/link-leakage" className="underline">Link Leakage (M4)</Link>.
        </p>
      </section>
    </div>
  );
}

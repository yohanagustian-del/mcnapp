import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { MatchingForm } from "./matching-form";

export default async function MatchingPage() {
  const member = await requireMember();
  const canRun = hasPermission("m5.run", member.role);

  const supabase = await createClient();
  const { data: creators } = await supabase
    .from("creators")
    .select("id, name")
    .in("status", ["binding", "aktif"])
    .order("name")
    .limit(1000);

  const { data: runs } = await supabase
    .from("matching_runs")
    .select("id, creator_id, window_start, created_at, creators(name)")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Creator Product Match</h1>
      <p className="mt-1 text-sm text-slate-500">
        Profil kreator per kategori (Level 2) dari AOV histori → segmen harga → produk Deal TAP dan PX
        Exchange di kategori & segmen yang sama, urut order tertinggi. Rule-based, 0 token AI.
      </p>

      {canRun ? (
        <div className="mt-6">
          <MatchingForm creators={creators ?? []} />
        </div>
      ) : (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Role Anda tidak punya izin menjalankan Product Match (CPM/CM Lead/Management/BizDev).
        </p>
      )}

      <h2 className="mt-8 text-lg font-medium">Riwayat Run Terakhir</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Waktu</th>
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">Window Mulai</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(runs ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{new Date(r.created_at).toLocaleString("id-ID")}</td>
                <td className="px-4 py-2 font-medium">
                  {(r.creators as unknown as { name: string } | null)?.name ?? r.creator_id}
                  <span className="ml-1 text-xs text-slate-400">{r.creator_id}</span>
                </td>
                <td className="px-4 py-2">{r.window_start}</td>
              </tr>
            ))}
            {(runs ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">Belum ada run matching.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

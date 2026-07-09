import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { PredictorForm } from "./predictor-form";

export default async function PredictorPage() {
  const member = await requireMember();
  const canRun = hasPermission("m6.run", member.role);

  const supabase = await createClient();
  // Distinct Level 2 categories for the datalist helper — Module 0.5 Fase 2:
  // creator_subcat_segment_gmv (transactions_all is dropped after ingest,
  // §2.7, so it would go stale/empty as the source for this list).
  const { data: catRows } = await supabase
    .from("creator_subcat_segment_gmv")
    .select("level2_category")
    .not("level2_category", "is", null)
    .order("level2_category")
    .limit(1000);
  const subCategories = [...new Set((catRows ?? []).map((r) => r.level2_category as string))];

  const { data: runs } = await supabase
    .from("deal_projections")
    .select("id, input, result, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Prediksi Nilai Deal (M6)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Proyeksi GMV campaign untuk BizDev: creator ber-track-record 28 hari di sub-kategori & segmen harga
        yang sama dengan produk deal → agregasi potensi GMV untuk brand (range). Tanpa komisi MEA. 0 token AI.
      </p>

      {canRun ? (
        <div className="mt-6">
          <PredictorForm subCategories={subCategories} />
        </div>
      ) : (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Role Anda tidak punya izin menjalankan prediksi deal (BizDev/Management).
        </p>
      )}

      <h2 className="mt-8 text-lg font-medium">Riwayat Proyeksi</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Waktu</th>
              <th className="px-4 py-3">Sub-kategori</th>
              <th className="px-4 py-3">Segmen</th>
              <th className="px-4 py-3">Potensi GMV (range)</th>
              <th className="px-4 py-3">Creator Relevan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(runs ?? []).map((r) => {
              const input = r.input as { sub_category?: string; segment?: string } | null;
              const result = r.result as { total_min?: number; total_max?: number; relevant?: number } | null;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2">{new Date(r.created_at).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-2 font-medium">{input?.sub_category ?? "—"}</td>
                  <td className="px-4 py-2">{input?.segment ?? "—"}</td>
                  <td className="px-4 py-2">
                    {result?.total_min !== undefined && result?.total_max !== undefined
                      ? `${rupiah(result.total_min)} – ${rupiah(result.total_max)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2">{result?.relevant ?? "—"}</td>
                </tr>
              );
            })}
            {(runs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Belum ada proyeksi.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

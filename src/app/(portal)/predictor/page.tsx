import { requireMember, hasPermission } from "@/lib/rbac";
import { getConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import type { PoolModelConfig } from "@/lib/m6/predictor";
import { listPoolCategories } from "./pool-actions";
import { PredictorForm } from "./predictor-form";

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

interface ScenarioInput {
  category?: string;
  segment?: string;
  brand_name?: string | null;
  // bentuk lama (sebelum pool model) — tetap dibaca supaya riwayat lama tidak hilang.
  sub_category?: string;
}
interface ScenarioResult {
  likely?: number;
  confidence?: number;
  // bentuk lama
  total_min?: number;
  total_max?: number;
  relevant?: number;
}

export default async function PredictorPage() {
  const member = await requireMember();
  const canRun = hasPermission("m6.run", member.role);

  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("deal_projections")
    .select("id, input, result, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  let categories: { category: string; creatorCount: number }[] = [];
  let windowDays = 28;
  let poolConfig: PoolModelConfig | null = null;
  if (canRun) {
    const [pools, cfg] = await Promise.all([
      listPoolCategories(),
      getConfig<PoolModelConfig>("m6.pool_model"),
    ]);
    categories = pools.categories;
    windowDays = pools.windowDays;
    poolConfig = cfg;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">BD Value Predictor</h1>
      <p className="mt-1 text-sm text-slate-500">
        Model pool: pilih kategori & segmen harga → centang kreator potensial (histori {windowDays} hari) →
        potensi GMV (likely/konservatif/optimis) + confidence. Tanpa skenario komisi, tanpa pitch — hanya
        daftar kreator potensial & potensi GMV. 0 token AI.
      </p>

      {canRun && poolConfig ? (
        <div className="mt-6">
          <PredictorForm categories={categories} config={poolConfig} />
        </div>
      ) : (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Role Anda tidak punya izin menjalankan prediksi deal (BizDev/Management).
        </p>
      )}

      <h2 className="mt-8 text-lg font-medium">Riwayat Skenario</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Waktu</th>
              <th className="px-4 py-3">Kategori</th>
              <th className="px-4 py-3">Segmen</th>
              <th className="px-4 py-3">Potensi GMV</th>
              <th className="px-4 py-3">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(runs ?? []).map((r) => {
              const input = r.input as ScenarioInput | null;
              const result = r.result as ScenarioResult | null;
              const category = input?.category ?? input?.sub_category ?? "—";
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2">{new Date(r.created_at).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-2 font-medium">{category}</td>
                  <td className="px-4 py-2">{input?.segment ?? "—"}</td>
                  <td className="px-4 py-2">
                    {result?.likely !== undefined
                      ? rupiah(result.likely)
                      : result?.total_min !== undefined && result?.total_max !== undefined
                        ? `${rupiah(result.total_min)} – ${rupiah(result.total_max)}`
                        : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {result?.confidence !== undefined ? `${result.confidence}%` : result?.relevant !== undefined ? `${result.relevant} kreator` : "—"}
                  </td>
                </tr>
              );
            })}
            {(runs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Belum ada skenario.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

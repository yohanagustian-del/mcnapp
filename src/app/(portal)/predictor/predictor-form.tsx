"use client";

import { useActionState } from "react";
import { runPrediction, type PredictorResult } from "./actions";

const SEGMENT_LABELS: Record<string, string> = {
  low: "Low-ticket (< 180rb)", entry: "Entry/mid-low (180–800rb)", sweet: "Sweet spot (800rb–3,6jt)",
  high: "High-ticket (3,6–8jt)", premium: "Premium (> 8jt)",
};

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** M6 on-demand deal prediction (BizDev). Potensi GMV untuk brand — tanpa komisi MEA. */
export function PredictorForm({ subCategories }: { subCategories: string[] }) {
  const [result, formAction, pending] = useActionState<PredictorResult | null, FormData>(
    runPrediction,
    null
  );

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Sub-kategori (Level 2)
          <input
            type="text" name="sub_category" required list="m6-subcats" placeholder="mis. Serum & Essence"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
          <datalist id="m6-subcats">
            {subCategories.map((s) => <option key={s} value={s} />)}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Harga produk deal (Rp)
          <input
            type="text" name="price" required placeholder="mis. 250000"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Durasi campaign (hari)
          <input
            type="number" name="duration_days" min={1} max={120} placeholder="28"
            className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Memproyeksikan..." : "Proyeksikan Deal"}
        </button>
      </form>

      {result && (
        <div className="mt-4">
          <div className={`rounded-md p-3 text-sm ${result.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
            {result.message}
          </div>

          {result.ok && (
            <>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase text-slate-500">Potensi GMV untuk Brand</p>
                  <p className="mt-1 text-xl font-semibold">
                    {rupiah(result.totalMin)} – {rupiah(result.totalMax)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {result.relevantCount} creator relevan · durasi {result.durationDays} hari
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase text-slate-500">Segmen Harga</p>
                  <p className="mt-1 text-xl font-semibold">{SEGMENT_LABELS[result.segment]}</p>
                  <p className="text-xs text-slate-400">Sub-kategori: {result.subCategory}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase text-slate-500">Basis Histori</p>
                  <p className="mt-1 text-xl font-semibold">Window sejak {result.windowStart}</p>
                  <p className="text-xs text-slate-400">GMV 28 hari (rolling) per sub-kategori & segmen</p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Creator</th>
                      <th className="px-4 py-3">Level</th>
                      <th className="px-4 py-3">GMV Basis (subkat+segmen)</th>
                      <th className="px-4 py-3">Proyeksi (range)</th>
                      <th className="px-4 py-3">GMV Total Window</th>
                      <th className="px-4 py-3">% dari Live</th>
                      <th className="px-4 py-3">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.creators.map((c) => (
                      <tr key={c.creatorId} className={c.isFallback ? "bg-amber-50/50" : ""}>
                        <td className="px-4 py-2 font-medium">
                          {c.name}
                          <span className="ml-1 text-xs text-slate-400">{c.creatorId}</span>
                        </td>
                        <td className="px-4 py-2">{c.level ? `L${c.level}` : "—"}</td>
                        <td className="px-4 py-2">{rupiah(c.basisGmv)}</td>
                        <td className="px-4 py-2">{rupiah(c.gmvMin)} – {rupiah(c.gmvMax)}</td>
                        <td className="px-4 py-2">{rupiah(c.totalGmv)}</td>
                        <td className="px-4 py-2">{c.liveShare === null ? "—" : `${(c.liveShare * 100).toFixed(0)}%`}</td>
                        <td className="px-4 py-2">
                          {c.isFallback ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              fallback segmen lain
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">relevan</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">⚠ {result.disclaimer}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

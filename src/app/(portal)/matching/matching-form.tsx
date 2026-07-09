"use client";

import { useActionState } from "react";
import { runMatching, type MatchingResult } from "./actions";

const SEGMENT_LABELS: Record<string, string> = {
  low: "Low-ticket", entry: "Entry/mid-low", sweet: "Sweet spot", high: "High-ticket", premium: "Premium",
};
const STATUS_LABELS: Record<string, string> = {
  via_agency: "Via Link Agency", bocor_sebagian: "Bocor Sebagian",
  bocor_total: "Bocor Total", belum_ada_link: "Belum Ada Link",
};

const rupiah = (n: number | null) =>
  n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;
const range = (min: number | null, max: number | null) =>
  min === null || max === null ? "rate perlu review" : `${rupiah(min)} – ${rupiah(max)}`;

/** M5 on-demand matching: pilih creator → daftar saran ter-ranking (0 token AI). */
export function MatchingForm({ creators }: { creators: { id: string; name: string }[] }) {
  const [result, formAction, pending] = useActionState<MatchingResult | null, FormData>(
    runMatching,
    null
  );

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <select name="creator_id" required className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">— Pilih creator —</option>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
          ))}
        </select>
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Mencocokkan..." : "Jalankan Matching"}
        </button>
        <span className="text-xs text-slate-500">
          Filter sub-kategori + segmen harga → ranking (bobot seimbang, tunable) → potensi komisi. Deterministik, 0 token AI.
        </span>
      </form>

      {result && (
        <div className="mt-4">
          <div className={`rounded-md p-3 text-sm ${result.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
            {result.message}
            {result.linkStatus && (
              <span className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-xs">
                Status M4: {STATUS_LABELS[result.linkStatus] ?? result.linkStatus}
              </span>
            )}
          </div>

          {result.suggestions.length > 0 && (
            <>
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Campaign / Brand</th>
                      <th className="px-4 py-3">Sub-kategori</th>
                      <th className="px-4 py-3">Segmen</th>
                      <th className="px-4 py-3">Skor</th>
                      <th className="px-4 py-3">Proyeksi GMV (range)</th>
                      <th className="px-4 py-3">Potensi Komisi Kreator</th>
                      <th className="px-4 py-3">Link Agency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.suggestions.map((s, i) => (
                      <tr key={s.dealId}>
                        <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-2 font-medium">
                          {s.campaignName ?? s.brandName}
                          <span className="ml-1 text-xs text-slate-400">{s.brandName} · {s.dealId}</span>
                        </td>
                        <td className="px-4 py-2">{s.matchedSubcat}</td>
                        <td className="px-4 py-2">
                          {s.segment ? SEGMENT_LABELS[s.segment] : "—"}
                          {s.segment && !s.segmentMatch && (
                            <span className="ml-1 text-xs text-amber-600">(belum terbukti)</span>
                          )}
                        </td>
                        <td className="px-4 py-2">{s.score.toFixed(3)}</td>
                        <td className="px-4 py-2">{rupiah(s.gmvMin)} – {rupiah(s.gmvMax)}</td>
                        <td className="px-4 py-2">{range(s.komisiMin, s.komisiMax)}</td>
                        <td className="px-4 py-2">
                          {s.hasAgencyLink ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">via agency ✓</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">belum ada link</span>
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

          {result.outsideAgency.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">
                SKU dipromosikan di luar link agency (data M4 — sumber bocor, ingatkan creator):
              </p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {result.outsideAgency.map((o, i) => (
                  <li key={i}>
                    Shop {o.shopId} · produk {o.productRef ?? "?"} · {STATUS_LABELS[o.status] ?? o.status}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

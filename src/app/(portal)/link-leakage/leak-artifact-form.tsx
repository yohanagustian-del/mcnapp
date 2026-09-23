"use client";

import { useState, useTransition } from "react";
import type { UploadLeakArtifactResult } from "@/lib/ingest/leak-run";
import { uploadLeakArtifactAction } from "./leak-artifact-actions";

const XLSX_ACCEPT =
  ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const STATUS_STYLES: Record<string, string> = {
  via_agency: "bg-green-100 text-green-800",
  bocor_sebagian: "bg-amber-100 text-amber-800",
  bocor_total: "bg-red-100 text-red-700",
  belum_ada_link: "bg-slate-100 text-slate-600",
};
const STATUS_LABELS: Record<string, string> = {
  via_agency: "Via Agency",
  bocor_sebagian: "Bocor Sebagian",
  bocor_total: "Bocor Total",
  belum_ada_link: "Belum Ada Link",
};

const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const statusLabel = (status: string | null) =>
  status === null ? "Tidak tersedia" : STATUS_LABELS[status] ?? status;
const statusStyle = (status: string | null) => (status === null ? "bg-slate-100 text-slate-500" : STATUS_STYLES[status] ?? "");

/** Upload hasil artifak Agency Leaked Generator (File 1 wajib + File 2 opsional). */
export function LeakArtifactForm() {
  const [result, setResult] = useState<UploadLeakArtifactResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await uploadLeakArtifactAction(formData);
      if (res.ok) {
        setResult(res.result);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <form action={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File 1 — Leak Detail Report (.xlsx) — wajib
          </label>
          <input
            type="file" name="leak_file" required accept={XLSX_ACCEPT}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File 2 — BD Opportunity Report (.xlsx) — opsional
          </label>
          <input
            type="file" name="bd_file" accept={XLSX_ACCEPT}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          <p className="mt-1 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
            File 2 mengisi pipeline BD (bd_leads) dari sheet BD_Shop_Summary. Lead yang sudah ada
            hanya diperbarui GMV/frekuensinya — status yang dikelola BizDev tidak diubah.
          </p>
        </div>
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Memproses..." : "Upload Hasil Artifak"}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Deterministik (0 token AI): parse artifak → validasi periode W1-W5 → hitung ulang status
        link & rasio bocor pakai ambang app_config yang sama dengan engine M4 → simpan rollup per
        kreator per minggu. Detail produk tetap di file Excel, tidak disimpan. Periode di luar
        window W1-W5 akan ditolak — jalankan artifak dengan rentang W1-W5.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-900">
          <p className="font-medium">
            Artifak diproses — periode {result.periodStart} s/d {result.periodEnd} (minggu {result.week}).
          </p>
          <p className="mt-1 text-xs">
            {result.creators.length} kreator · BD leads: {result.bdShopsNew} baru, {result.bdShopsUpdated} diperbarui.
          </p>

          {result.format === "v2" && (
            <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Format artifak baru terdeteksi — status link, % bocor, dan GMV TAP per kreator tidak
              tersedia di file ini (unknown, bukan nol). Hanya Total Affiliate GMV per kreator yang
              tersimpan; totals level-CM (Total Affiliate, Total TAP, Potential Leak) tersimpan
              terpisah per minggu.
            </p>
          )}

          {result.creators.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-green-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Kreator</th>
                    <th className="px-3 py-2">Status Link</th>
                    <th className="px-3 py-2">% Bocor</th>
                    <th className="px-3 py-2">Efektivitas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.creators.map((c) => (
                    <tr key={c.creatorId}>
                      <td className="px-3 py-2 text-slate-800">
                        {c.creatorName}
                        {c.createdProspect && (
                          <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-700">baru</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 font-medium ${statusStyle(c.linkStatus)}`}>
                          {statusLabel(c.linkStatus)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{pct(c.leakRatio)}</td>
                      <td className="px-3 py-2">{pct(c.effectiveness)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.skipped.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-amber-700">
                {result.skipped.length} catatan / dilewati
              </summary>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                {result.skipped.slice(0, 50).map((s, i) => <li key={i}>{s}</li>)}
                {result.skipped.length > 50 && <li>… {result.skipped.length - 50} lainnya</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

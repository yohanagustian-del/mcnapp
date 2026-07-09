"use client";

import { useState, useTransition } from "react";
import type { RunIngestResult } from "@/lib/ingest/run";
import { runIngestAction } from "./actions";

const FILE_ACCEPT =
  ".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers,text/csv";

/** Single weekly upload form (Module 0.5): MCN wajib, TAP opsional (disarankan). */
export function IngestForm() {
  const [result, setResult] = useState<RunIngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tapChosen, setTapChosen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await runIngestAction(formData);
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
            File MCN TikTok report (semua transaksi) — wajib
          </label>
          <input
            type="file" name="mcn_file" required accept={FILE_ACCEPT}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File TAP report (via agency link) — opsional, disarankan
          </label>
          <input
            type="file" name="tap_file" accept={FILE_ACCEPT}
            onChange={(e) => setTapChosen((e.target.files?.length ?? 0) > 0)}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          {!tapChosen && (
            <p className="mt-1 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              ⚠ File TAP dipakai untuk memperkaya katalog produk (products_tap). Upload TAP periode
              yang sama bila tersedia agar katalog produk ikut ter-update.
            </p>
          )}
        </div>
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Memproses..." : "Proses Upload Mingguan"}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Pipeline deterministik (0 token AI): parse → tabel agregat performa → raw dibuang (tidak
        pernah disimpan ke DB). Periode terdeteksi otomatis dari kolom Date. Idempotent per periode —
        upload ulang menimpa hasil lama. Analisis kebocoran link agency kini dilakukan lewat artifak
        Agency Leaked Generator terpisah; halaman ini hanya memproses agregat performa.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-900">
          <p className="font-medium">
            Batch {result.batchId} selesai — periode {result.periodStart} s/d {result.periodEnd}.
          </p>
          <ul className="mt-2 list-inside list-disc text-xs">
            <li>
              {result.rowsProcessedMcn} baris MCN + {result.rowsProcessedTap} baris TAP diproses ·{" "}
              {result.creatorsCount} creator
            </li>
            <li>
              Agregat tersimpan: {result.aggregateRows.periodSummary} ringkasan periode ·{" "}
              {result.aggregateRows.subcatSegment} subkategori×segmen ·{" "}
              {result.aggregateRows.topProducts} top produk
            </li>
            <li>
              Raw transaksi tidak disimpan ke DB — hanya agregat performa yang ditulis.
            </li>
          </ul>
          {result.createdProspects.length > 0 && (
            <p className="mt-2 text-xs">
              Creator baru dibuat otomatis: {result.createdProspects.join(", ")}
            </p>
          )}
          {result.skipped.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-amber-700">
                {result.skipped.length} baris dilewati / catatan
              </summary>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                {result.skipped.slice(0, 50).map((s, i) => (
                  <li key={i}>
                    {s.row > 0 ? `Baris ${s.row}: ` : ""}
                    {s.reason}
                  </li>
                ))}
                {result.skipped.length > 50 && <li>… {result.skipped.length - 50} lainnya</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

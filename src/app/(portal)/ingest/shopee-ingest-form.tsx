"use client";

import { useState, useTransition } from "react";
import type { RunShopeeIngestResult } from "@/lib/ingest/shopee-run";
import { uploadIngestFile } from "@/lib/ingest/upload-client";
import { runShopeeIngestFromStorageAction } from "./shopee-actions";

const FILE_ACCEPT = ".csv,text/csv";

/** Shopee card upload form (Lane 1) — satu slot file: Conversion Report gabungan MCN + SAP. */
export function ShopeeIngestForm() {
  const [result, setResult] = useState<RunShopeeIngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setResult(null);
    const file = formData.get("shopee_file");
    if (!(file instanceof File) || file.size === 0) {
      setError("File Conversion Report Shopee (gabungan MCN + SAP) wajib diunggah");
      return;
    }
    startTransition(async () => {
      try {
        setStage("Mengunggah file ke storage…");
        const ref = await uploadIngestFile(file, "shopee");
        setStage("Memproses agregat di server…");
        const res = await runShopeeIngestFromStorageAction(ref);
        if (res.ok) {
          setResult(res.result);
        } else {
          setError(res.error);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga saat mengunggah.");
      } finally {
        setStage(null);
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <form action={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File Conversion Report Shopee (gabungan MCN + SAP) — wajib
          </label>
          <input
            type="file" name="shopee_file" required accept={FILE_ACCEPT}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </div>
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? (stage ?? "Memproses...") : "Proses Upload Mingguan"}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Hanya pesanan berstatus Selesai yang dihitung (acuan tanggal: Waktu Pesanan Selesai). Window
        mingguan W1-W5 sama seperti TikTok (W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir bulan) —
        semua baris Selesai di file harus berada dalam satu window yang sama. Upload ulang untuk
        window yang sama akan menimpa hasil lama (idempotent). Analisis kebocoran link agency Shopee
        akan tersedia lewat artifak Agency Leaked Generator terpisah (menyusul) — halaman ini hanya
        memproses agregat GMV mingguan.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-900">
          <p className="font-medium">
            Batch {result.batchId} selesai — periode {result.periodStart} s/d {result.periodEnd}.
          </p>
          <ul className="mt-2 list-inside list-disc text-xs">
            <li>
              {result.rowsCompleted} baris Selesai dari {result.rowsTotal} baris total ·{" "}
              {result.rowsUsed} baris dipakai · {result.creatorsCount} creator
            </li>
            <li>GMV total periode ini: Rp{result.gmvTotal.toLocaleString("id-ID")}</li>
            <li>Raw transaksi tidak disimpan ke DB — hanya agregat GMV mingguan yang ditulis.</li>
          </ul>
          {result.createdProspects.length > 0 && (
            <p className="mt-2 text-xs">
              Creator baru dibuat otomatis (platform Shopee): {result.createdProspects.join(", ")}
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

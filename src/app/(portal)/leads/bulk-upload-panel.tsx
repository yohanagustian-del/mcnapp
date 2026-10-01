"use client";

import { useRef, useState, useTransition } from "react";
import { BRAND_LEAD_SOURCES, BRAND_LEAD_SOURCE_LABELS } from "@/lib/leads/brand-lead";
import { downloadBase64File, XLSX_MIME } from "@/lib/utils/download";
import { downloadBrandLeadTemplate, uploadBrandLeads, type BrandLeadUploadReport } from "./bulk-actions";

const btnPrimary =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/**
 * Upload massal Brand Lead Bank dari spreadsheet matchmaking — satu file berisi banyak
 * lead brand. Asal lead dipilih sekali untuk seluruh file.
 */
export function BulkUploadPanel() {
  const [report, setReport] = useState<BrandLeadUploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onDownloadTemplate() {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, base64 } = await downloadBrandLeadTemplate();
        downloadBase64File(filename, base64, XLSX_MIME);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengunduh template");
      }
    });
  }

  function onUpload(formData: FormData) {
    setError(null);
    setReport(null);
    startTransition(async () => {
      try {
        setReport(await uploadBrandLeads(formData));
        if (fileRef.current) fileRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memproses file");
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">Upload Massal Lead (Excel/CSV)</h2>
      <p className="mt-1 text-xs text-slate-500">
        Untuk hasil matchmaking/event yang berisi banyak brand. Kolom mengikuti spreadsheet matchmaking:{" "}
        <strong>Nama Brand</strong>, Bizdev, Niche, Link Toko Seller / Brand, Contact PIC Brand, Grup Brand,
        Sample/Flash Sale/Ads, Ads Brand (+ opsional Kota, Platform, Catatan). Spreadsheet yang sudah ada boleh
        langsung diupload (download dari Google Sheets sebagai .xlsx atau .csv). Brand yang sudah ada tidak dibuat
        dua kali — kontak baru & kolom yang masih kosong ditambahkan ke lead lama, isi lama tidak ditimpa.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <button type="button" onClick={onDownloadTemplate} disabled={pending} className={btnSecondary}>
          Download Template
        </button>
        <form action={onUpload} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500">Asal Lead (semua baris) *</label>
            <select name="source" defaultValue="matchmaking" required className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm">
              {BRAND_LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>{BRAND_LEAD_SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <input
            ref={fileRef}
            type="file"
            name="file"
            required
            accept=".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Memproses..." : "Upload Lead"}
          </button>
        </form>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Baris: {report.totalRows}</span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Lead baru: {report.created}</span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Ditambahkan ke lead lama: {report.merged}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Sudah ada, tanpa data baru: {report.unchanged}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Kontak tersimpan: {report.contactsAdded}</span>
            {report.skipped > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Dilewati: {report.skipped}</span>
            )}
          </div>
          {report.rowNotes.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-700">{report.rowNotes.length} catatan per baris</summary>
              <ul className="mt-1 list-disc pl-5 text-slate-600">
                {report.rowNotes.map((n, i) => (
                  <li key={i}>
                    Baris {n.rows}
                    {n.brand ? ` (${n.brand})` : ""}: {n.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

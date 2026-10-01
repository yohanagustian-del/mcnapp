"use client";

import { useRef, useState, useTransition } from "react";
import {
  downloadPartnershipTemplate,
  uploadPartnershipStatus,
  type PartnershipUploadReport,
} from "./partnership-actions";

const btnPrimary =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/**
 * Upload status kemitraan (Management Partnership + Fee Agreement) from the user's
 * Excel file — the only way these statuses change (no per-row edit, Q2).
 */
export function PartnershipUploadPanel({ lastUploadAt }: { lastUploadAt: string | null }) {
  const [report, setReport] = useState<PartnershipUploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onDownloadTemplate() {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, base64 } = await downloadPartnershipTemplate();
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
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
        setReport(await uploadPartnershipStatus(formData));
        if (fileRef.current) fileRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memproses file");
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onDownloadTemplate} disabled={pending} className={btnSecondary}>
          Download Template
        </button>
        <form action={onUpload} className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            name="file"
            required
            accept=".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Memproses..." : "Upload Status Kemitraan"}
          </button>
        </form>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Kolom: <strong>Username*</strong>, Nama Kreator, Platform (kosong = tiktok), Management Partnership,
        Fee Agreement (khusus TikTok). Username dicocokkan ke kreator yang sudah terdaftar; yang tidak ditemukan
        dilewati. Status yang turun (mis. LINKED → UNLINK REQ, AGREE → DISAGREE) menjadi alert ke CM pemilik.
        {lastUploadAt && <> Upload terakhir: {new Date(lastUploadAt).toLocaleString("id-ID")}.</>}
      </p>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Baris: {report.totalRows}</span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Cocok: {report.matched}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              Tak dikenal: {report.unknownUsernames.length}
            </span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Berubah: {report.changed}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Tetap: {report.unchanged}</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">Alert: {report.alerts}</span>
          </div>
          {report.unknownUsernames.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-800">
                {report.unknownUsernames.length} username tidak ditemukan (dilewati)
              </summary>
              <p className="mt-1 text-slate-600">{report.unknownUsernames.join(", ")}</p>
            </details>
          )}
          {report.rowNotes.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-700">{report.rowNotes.length} catatan per baris</summary>
              <ul className="mt-1 list-disc pl-5 text-slate-600">
                {report.rowNotes.map((n, i) => (
                  <li key={i}>
                    Baris {n.rowNumber}
                    {n.username ? ` (@${n.username})` : ""}: {n.message}
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

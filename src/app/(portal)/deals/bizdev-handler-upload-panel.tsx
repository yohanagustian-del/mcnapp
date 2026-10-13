"use client";

import { useRef, useState, useTransition } from "react";
import {
  downloadBizdevHandlerTemplate,
  uploadBrandBizdevHandlers,
  type BizdevHandlerUploadReport,
} from "./bizdev-handler-actions";

const btnPrimary =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/** Upload Excel massal BizDev handler (Q1) — pola PartnershipUploadPanel. */
export function BizdevHandlerUploadPanel() {
  const [report, setReport] = useState<BizdevHandlerUploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onDownloadTemplate() {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, base64 } = await downloadBizdevHandlerTemplate();
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
        setReport(await uploadBrandBizdevHandlers(formData));
        if (fileRef.current) fileRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memproses file");
      }
    });
  }

  return (
    <details className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">Upload BizDev Handler (Excel)</summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onDownloadTemplate} disabled={pending} className={btnSecondary}>
          Download Template
        </button>
        <form action={onUpload} className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            name="file"
            required
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Memproses..." : "Upload BizDev Handler"}
          </button>
        </form>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Kolom: <strong>Shop ID</strong>, <strong>Shop Name</strong>, <strong>BizDev 1</strong>, <strong>BizDev 2</strong>.
        Shop dicari lewat Shop ID lalu Shop Name; shop atau nama BizDev yang tidak dikenal dilewati dan ditampilkan
        di bawah. Nama yang diisi menggantikan BizDev lama brand itu; baris yang kedua kolom BizDev-nya kosong tidak
        mengubah apa pun.
      </p>
      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          <p>
            {report.totalRows} baris · <strong>{report.changed} brand diubah</strong> · {report.unchanged} tetap ·{" "}
            {report.blank} baris tanpa BizDev (tidak mengubah)
          </p>
          {(report.unknownShops.length > 0 || report.unknownNames.length > 0) && (
            <div role="alert" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              {report.unknownShops.length > 0 && (
                <p>
                  <strong>{report.unknownShops.length} shop dilewati</strong> (tidak ditemukan di tab Deal Brand):{" "}
                  {report.unknownShops.join(", ")}
                </p>
              )}
              {report.unknownNames.length > 0 && (
                <p className="mt-1">
                  <strong>Nama BizDev tidak dikenal</strong> (bukan anggota tim aktif ber-role BizDev):{" "}
                  {report.unknownNames.join(", ")}
                </p>
              )}
            </div>
          )}
          {report.rowNotes.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {report.rowNotes.slice(0, 50).map((n, i) => (
                <li key={i}>
                  Baris {n.rowNumber}: {n.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

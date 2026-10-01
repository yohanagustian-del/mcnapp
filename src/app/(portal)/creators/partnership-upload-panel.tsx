"use client";

import { useRef, useState, useTransition } from "react";
import {
  downloadPartnershipTemplate,
  uploadPartnershipStatus,
  type PartnershipUploadReport,
} from "./partnership-actions";
import type { PartnershipUploadSummary } from "@/lib/creators/partnership";

/**
 * Prominent notice listing creators an upload skipped (user decision A3): unregistered
 * usernames are never created as prospects, so the uploader must see them to follow up.
 */
function SkippedNotice({
  title,
  unknown,
  outOfScope,
}: {
  title: string;
  unknown: string[];
  outOfScope: string[];
}) {
  if (unknown.length === 0 && outOfScope.length === 0) return null;
  return (
    <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-semibold">⚠ {title}</p>
      {unknown.length > 0 && (
        <p className="mt-1">
          <strong>{unknown.length} kreator dilewati</strong> karena username belum terdaftar di menu Kreator
          (daftarkan dulu, lalu upload ulang): {unknown.join(", ")}
        </p>
      )}
      {outOfScope.length > 0 && (
        <p className="mt-1">
          <strong>{outOfScope.length} kreator dilewati</strong> karena dipegang CM lain (CPM hanya bisa mengubah
          kreator miliknya): {outOfScope.join(", ")}
        </p>
      )}
    </div>
  );
}

const btnPrimary =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/**
 * Upload status kemitraan (Management Partnership + Fee Agreement) from the user's
 * Excel file — the only way these statuses change (no per-row edit, Q2).
 */
export function PartnershipUploadPanel({ lastUpload }: { lastUpload: PartnershipUploadSummary | null }) {
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
        dilewati dan ditampilkan sebagai peringatan. CPM hanya bisa mengubah kreator miliknya. Status yang turun (mis. LINKED → UNLINK REQ, AGREE → DISAGREE) menjadi alert ke CM pemilik.
        {lastUpload && (
          <>
            {" "}Upload terakhir: {new Date(lastUpload.createdAt).toLocaleString("id-ID")}
            {lastUpload.fileName ? ` (${lastUpload.fileName})` : ""}.
          </>
        )}
      </p>

      {!report && lastUpload && (
        <SkippedNotice
          title="Upload terakhir melewati sebagian kreator"
          unknown={lastUpload.unknownUsernames}
          outOfScope={lastUpload.outOfScopeUsernames}
        />
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Baris: {report.totalRows}</span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Cocok: {report.matched}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              Tak dikenal: {report.unknownUsernames.length}
            </span>
            {report.outOfScopeUsernames.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                Kreator CM lain: {report.outOfScopeUsernames.length}
              </span>
            )}
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Berubah: {report.changed}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Tetap: {report.unchanged}</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">Alert: {report.alerts}</span>
          </div>
          <SkippedNotice
            title="Sebagian kreator di file ini dilewati"
            unknown={report.unknownUsernames}
            outOfScope={report.outOfScopeUsernames}
          />
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

"use client";

import { useState, useTransition } from "react";
import { downloadProjectOverviewReport } from "./report-actions";
import { downloadBase64File, XLSX_MIME } from "@/lib/utils/download";

export function DownloadReportButton({ projectId }: { projectId: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              const { filename, base64 } = await downloadProjectOverviewReport(projectId);
              downloadBase64File(filename, base64, XLSX_MIME);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Gagal mengunduh report");
            }
          });
        }}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? "Menyiapkan…" : "Download Report"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

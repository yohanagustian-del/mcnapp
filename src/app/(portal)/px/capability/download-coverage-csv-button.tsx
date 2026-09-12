"use client";

import { useState, useTransition } from "react";
import { downloadCapabilityCoverageCsv } from "./actions";

/** Pola: builder string di server (buildCoverageCsv) + Blob di client — sama seperti link-leakage/download-csv-button.tsx. */
export function DownloadCoverageCsvButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        const { filename, csv } = await downloadCapabilityCoverageCsv(fd);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengunduh CSV");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? "Menyiapkan..." : "Download CSV"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

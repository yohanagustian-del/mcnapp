"use client";

import { useState, useTransition } from "react";
import { downloadLeakageCsv } from "./actions";

/**
 * Triggers the leak-detail CSV export server action and streams the returned
 * string to a browser download. Filters (creator/week) are passed through as
 * hidden fields — omitted → export everything still within the retention window.
 */
export function DownloadCsvButton({
  creatorId,
  week,
  label = "Download CSV",
}: {
  creatorId?: string | null;
  week?: string | null;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        if (creatorId) fd.set("creator_id", creatorId);
        if (week) fd.set("week", week);
        const { filename, csv } = await downloadLeakageCsv(fd);
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
        {pending ? "Menyiapkan..." : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

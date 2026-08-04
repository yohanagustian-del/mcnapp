"use client";

import { useState, useTransition } from "react";
import { downloadCreatorLeakDetail } from "./actions";

/**
 * Per-row "Detail" button in the Link Leakage table: downloads the per-(shop, product)
 * leak detail of ONE creator for the row's week as CSV.
 *
 * The action returns a result union (Next.js censors thrown server-action messages in
 * production), so a missing backup / creator with no leaking product renders as an
 * inline explanation instead of a silent no-op.
 */
export function CreatorLeakDetailButton({
  creatorId,
  week,
  label = "Detail",
}: {
  creatorId: string;
  week: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await downloadCreatorLeakDetail(creatorId, week);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title={`Unduh detail produk bocor kreator ini (minggu ${week})`}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? "Menyiapkan…" : label}
      </button>
      {error && <p className="mt-1 max-w-xs text-[11px] leading-tight text-red-600">{error}</p>}
    </>
  );
}

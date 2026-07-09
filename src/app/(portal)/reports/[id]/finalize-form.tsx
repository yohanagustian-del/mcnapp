"use client";

import { useActionState } from "react";
import { finalizeReport, type ReportActionState } from "../actions";

export function FinalizeForm({
  reportId,
  insightDraft,
}: {
  reportId: number;
  insightDraft: string | null;
}) {
  const [state, formAction, pending] = useActionState<ReportActionState | null, FormData>(
    finalizeReport,
    null
  );

  return (
    <form action={formAction} className="print:hidden">
      <input type="hidden" name="report_id" value={reportId} />
      <label className="mb-1 block text-sm font-medium">Edit insight sebelum finalisasi</label>
      <textarea
        name="insight_final"
        defaultValue={insightDraft ?? ""}
        rows={8}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Insight draft kosong (report data-only) — tulis catatan manual bila perlu."
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Menyimpan..." : "Finalisasi Report"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Export (Print / PDF)
        </button>
      </div>
      {state && (
        <p className={`mt-3 rounded-md p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

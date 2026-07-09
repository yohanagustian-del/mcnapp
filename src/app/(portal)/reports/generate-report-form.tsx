"use client";

import { useActionState } from "react";
import { generateReport, type ReportActionState } from "./actions";

export function GenerateReportForm({ creators }: { creators: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<ReportActionState | null, FormData>(
    generateReport,
    null
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <select name="creator_id" required defaultValue="" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="" disabled>Creator…</option>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
          ))}
        </select>
        <select name="period_type" required defaultValue="weekly" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <input type="date" name="period_start" required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Menghitung..." : "Generate Report"}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Data layer deterministik (0 token). Insight LLM hanya dipanggil bila delta GMV/views
        melewati threshold (weekly) — monthly selalu ber-insight.
      </p>
      {state && (
        <p className={`mt-3 rounded-md p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {state.message}
          {state.ok && state.reportId && (
            <> <a href={`/reports/${state.reportId}`} className="font-medium underline">Buka report →</a></>
          )}
        </p>
      )}
    </div>
  );
}

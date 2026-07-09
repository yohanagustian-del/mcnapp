"use client";

import { useActionState } from "react";
import { generateBrandReport, type BrandReportState } from "./actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const FILE_ACCEPT =
  ".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers,text/csv";

export function BrandReportForm({ deals }: { deals: { id: string; brand_name: string }[] }) {
  const [state, action, pending] = useActionState<BrandReportState | null, FormData>(
    generateBrandReport,
    null
  );

  return (
    <form action={action} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
      <select name="deal_id" required className={input}>
        <option value="">— deal / brand —</option>
        {deals.map((d) => <option key={d.id} value={d.id}>{d.brand_name} ({d.id})</option>)}
      </select>
      <label className="flex items-center gap-2 text-xs text-slate-500">Mulai
        <input type="date" name="period_start" required className={`${input} flex-1 text-slate-900`} />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-500">Selesai (eksklusif)
        <input type="date" name="period_end" required className={`${input} flex-1 text-slate-900`} />
      </label>
      <input name="ads_spend" placeholder="Ads spend brand (Rp, opsional — untuk ROAS)" className={`${input} lg:col-span-2`} />
      <label className="flex flex-col gap-1 text-xs text-slate-500 lg:col-span-3">
        File platform shop ini (export ter-filter shop_id, periode report) — wajib
        <input
          type="file" name="mcn_file" required accept={FILE_ACCEPT}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
        />
        <span className="text-[11px] text-slate-400">
          Diproses in-memory lalu dibuang — tidak disimpan. Hanya hasil report tersimpan.
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" name="with_summary" className="h-4 w-4" />
        Ringkasan naratif (1 LLM call, opsional)
      </label>
      <button type="submit" disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 lg:col-span-3">
        {pending ? "Menghitung…" : "Generate Report Brand"}
      </button>
      {state && (
        <p className={`text-sm lg:col-span-3 ${state.ok ? "text-green-700" : "text-red-600"}`}>{state.message}</p>
      )}
    </form>
  );
}

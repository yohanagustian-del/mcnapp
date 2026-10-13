"use client";

import { useActionState } from "react";
import { saveBrandReportEdits, type BrandReportActionState } from "../actions";
import { BRAND_REPORT_TEXT_KEYS, BRAND_REPORT_TEXT_LABEL, type BrandReportTexts } from "@/lib/brand-report/rules";

/** Sunting TEKS report (edits_json). Mengosongkan kolom = kembali ke kalimat bawaan. */
export function EditBrandReportTextsForm({ reportId, texts }: { reportId: number; texts: BrandReportTexts }) {
  const [state, action, pending] = useActionState<BrandReportActionState | null, FormData>(
    saveBrandReportEdits.bind(null, reportId),
    null
  );
  return (
    <form action={action} className="space-y-3">
      {state && (
        <p className={`rounded-md p-2 text-sm ${state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{state.message}</p>
      )}
      {BRAND_REPORT_TEXT_KEYS.map((k) => (
        <label key={k} className="block text-xs font-medium text-slate-600">
          {BRAND_REPORT_TEXT_LABEL[k]}
          <textarea
            name={k}
            defaultValue={texts[k]}
            rows={2}
            maxLength={2000}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800"
          />
        </label>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menyimpan…" : "Simpan teks"}
      </button>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";

export interface UploadReport {
  inserted: number;
  skipped: { row: number; reason: string }[];
}

/**
 * Reusable CSV upload form for bulk actions (tim, kreator, master deal, pipeline).
 * Extra inputs (week picker, source select, creator picker) go in `children`.
 */
export function CsvUploadForm({
  action,
  buttonLabel,
  helpText,
  children,
}: {
  action: (formData: FormData) => Promise<UploadReport>;
  buttonLabel: string;
  helpText: string;
  children?: React.ReactNode;
}) {
  const [report, setReport] = useState<UploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setReport(null);
    startTransition(async () => {
      try {
        setReport(await action(formData));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan");
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <form action={onSubmit} className="flex flex-wrap items-center gap-3">
        {children}
        <input
          type="file" name="file" required
          accept=".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers,text/csv"
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
        />
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Memproses..." : buttonLabel}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">{helpText}</p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="mt-3 text-sm">
          <p className="font-medium text-green-700">{report.inserted} baris berhasil diproses.</p>
          {report.skipped.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-amber-700">
                {report.skipped.length} baris dilewati / perlu review
              </summary>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                {report.skipped.map((s, i) => (
                  <li key={i}>
                    {s.row > 0 ? `Baris ${s.row}: ` : ""}{s.reason}
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

"use client";

import { useState, useTransition } from "react";

export interface UploadReport {
  inserted: number;
  skipped: { row: number; reason: string }[];
  /** Alasan kegagalan yang dikembalikan action (bukan di-throw — lihat tim/actions.ts). */
  error?: string;
  /** Rincian hasil ("Produk baru: 120", …) — opsional, ditampilkan sebagai grid kecil. */
  summary?: { label: string; value: string }[];
  /** Peringatan non-fatal: upload berhasil tapi ada yang perlu ditindaklanjuti. */
  warning?: string;
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
        const result = await action(formData);
        // Action yang mengembalikan `error` gagal secara terkendali (pesannya utuh);
        // throw dari server action sudah disensor Next.js di production.
        if (result.error) setError(result.error);
        setReport(result);
      } catch (e) {
        setError(
          e instanceof Error && !/Server Components render/i.test(e.message)
            ? e.message
            : "Upload gagal di server. Periksa format file (kolom wajib, sheet yang benar) lalu coba lagi."
        );
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

      {/* Status upload selalu eksplisit: satu banner GAGAL atau BERHASIL, bukan
          hanya angka baris — supaya user tidak perlu menebak apakah file masuk. */}
      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3" role="alert">
          <p className="text-sm font-semibold text-red-800">✕ Upload gagal</p>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
      )}

      {report && !error && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3" role="status">
          <p className="text-sm font-semibold text-green-800">
            ✓ Upload berhasil — {report.inserted.toLocaleString("id-ID")} baris tersimpan
          </p>
          {report.summary && report.summary.length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-green-900 sm:grid-cols-3">
              {report.summary.map((s) => (
                <div key={s.label} className="flex justify-between gap-2">
                  <dt className="text-green-800">{s.label}</dt>
                  <dd className="font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {report.warning && <p className="mt-2 text-xs text-amber-800">⚠ {report.warning}</p>}
        </div>
      )}

      {report && report.skipped.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-amber-700">
            {report.skipped.length} baris dilewati / perlu review
          </summary>
          <ul className="mt-1 max-h-56 list-inside list-disc overflow-y-auto text-xs text-slate-600">
            {report.skipped.map((s, i) => (
              <li key={i}>
                {s.row > 0 ? `Baris ${s.row}: ` : ""}{s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

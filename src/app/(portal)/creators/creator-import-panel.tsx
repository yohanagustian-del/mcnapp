"use client";

import { useRef, useState, useTransition } from "react";
import {
  downloadCreatorTemplate,
  previewCreatorImport,
  commitCreatorImport,
  type CommitReport,
  type ImportPreview,
} from "./import-actions";

const STATUS_STYLE: Record<string, { badge: string; row: string; label: string }> = {
  insert: { badge: "bg-green-100 text-green-800", row: "bg-green-50/60", label: "＋ Baru" },
  update: { badge: "bg-amber-100 text-amber-800", row: "bg-amber-50/60", label: "↻ Update CM" },
  error: { badge: "bg-red-100 text-red-800", row: "bg-red-50/60", label: "✕ Error" },
};

const btnPrimary =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/**
 * Import kreator massal (username + CM) dari Excel, dengan preview wajib
 * sebelum menyimpan.
 *
 * Alur: Download Template → pilih file → preview (insert / update / error per
 * baris) → Simpan atau Batal. Tidak ada penulisan ke DB sampai user menekan
 * Simpan, dan baris error tidak pernah ikut tersimpan.
 */
export function CreatorImportPanel() {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<CommitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPreview(null);
    setReport(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onDownloadTemplate() {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, base64 } = await downloadCreatorTemplate();
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengunduh template");
      }
    });
  }

  function onPreview(formData: FormData) {
    setError(null);
    setReport(null);
    setPreview(null);
    startTransition(async () => {
      try {
        setPreview(await previewCreatorImport(formData));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal membaca file");
      }
    });
  }

  function onCommit() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await commitCreatorImport(preview.rawRows);
        setReport(result);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menyimpan data");
      }
    });
  }

  const summary = preview?.summary;
  const savable = summary ? summary.insert + summary.update : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onDownloadTemplate} disabled={pending} className={btnSecondary}>
          Download Template
        </button>

        <form action={onPreview} className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            name="file"
            required
            accept=".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Memproses..." : "Import Kreator"}
          </button>
        </form>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Kolom wajib: <strong>Username</strong> dan <strong>CM</strong>. Username yang sudah ada di
        sistem akan <strong>diganti CM-nya</strong> dengan CM di file (replace, bukan tambah);
        username baru dibuat sebagai kreator baru. Data ditampilkan sebagai preview dulu — tidak ada
        yang tersimpan sebelum Anda menekan Simpan.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium text-green-700">
            {report.inserted} kreator baru ditambahkan, {report.updated} kreator di-update.
          </p>
          {report.skipped.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-amber-700">
                {report.skipped.length} baris dilewati
              </summary>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                {report.skipped.map((s, i) => (
                  <li key={i}>Baris {s.row}: {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
          {report.commissionAlerts.length > 0 && (
            <details className="mt-2" open>
              <summary className="cursor-pointer text-amber-700">
                {report.commissionAlerts.length} sharing komisi TIDAK diubah (read-only, tercatat
                sebagai alert)
              </summary>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                {report.commissionAlerts.map((a, i) => (
                  <li key={i}>
                    Baris {a.row} ({a.username}): sistem {(a.from * 100).toFixed(1)}% vs sheet{" "}
                    {(a.to * 100).toFixed(1)}% — nilai sistem dipertahankan.
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {preview && summary && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Preview {preview.rows.length} baris:</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE.insert.badge}`}>
              {summary.insert} baru
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE.update.badge}`}>
              {summary.update} update CM
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE.error.badge}`}>
              {summary.error} error
            </span>
          </div>

          {summary.error > 0 && (
            <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
              Baris error tidak akan disimpan. Perbaiki file lalu unggah ulang bila semua baris harus masuk.
            </p>
          )}

          <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Baris</th>
                  <th className="px-3 py-2">Aksi</th>
                  <th className="px-3 py-2">CM Lama → Baru</th>
                  {preview.columns.map((c) => (
                    <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>
                  ))}
                  <th className="px-3 py-2">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((r) => {
                  const style = STATUS_STYLE[r.status];
                  return (
                    <tr key={r.rowNum} className={style.row}>
                      <td className="px-3 py-2 text-slate-500">{r.rowNum}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {r.status === "update" ? (
                          <>
                            <span className="text-slate-400 line-through">{r.previousCmName ?? "—"}</span>
                            <span className="mx-1">→</span>
                            <span className="font-medium text-amber-800">{r.cmName}</span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      {preview.columns.map((c) => (
                        <td key={c} className="px-3 py-2 whitespace-nowrap">
                          {r.values[c] || <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-xs">
                        {r.errors.length > 0 && (
                          <span className="text-red-700">{r.errors.join("; ")}</span>
                        )}
                        {r.warnings.length > 0 && (
                          <span className="block text-amber-700">{r.warnings.join("; ")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={onCommit} disabled={pending || savable === 0} className={btnPrimary}>
              {pending ? "Menyimpan..." : `Simpan ${savable} baris`}
            </button>
            <button type="button" onClick={reset} disabled={pending} className={btnSecondary}>
              Batal
            </button>
            {savable === 0 && (
              <span className="text-xs text-red-700">
                Tidak ada baris valid untuk disimpan — perbaiki file dulu.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

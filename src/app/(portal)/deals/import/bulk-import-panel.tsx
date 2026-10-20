"use client";

import { useRef, useState, useTransition } from "react";
import { commitBulkDeals, exportBulkDeals, previewBulkDeals, type BulkImportResult } from "./actions";
import { BulkPlanView } from "./bulk-plan-view";

const btnPrimary =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/** Preview → Simpan → Export. File disimpan di state supaya Simpan memakai file yang sama. */
export function BulkImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function run(kind: "preview" | "commit") {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      try {
        const res = kind === "preview" ? await previewBulkDeals(fd) : await commitBulkDeals(fd);
        setResult(res);
        setPreviewed(kind === "preview" && res.ok);
      } catch {
        setResult({ ok: false, error: "Gagal di server. Coba lagi atau periksa file." });
      }
    });
  }

  function onExport() {
    startTransition(async () => {
      const { filename, base64 } = await exportBulkDeals();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const p = result?.plan;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setPreviewed(false);
          }}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
        />
        <button type="button" disabled={!file || pending} onClick={() => run("preview")} className={btnSecondary}>
          {pending ? "Memproses..." : "1. Preview"}
        </button>
        <button
          type="button"
          disabled={!file || !previewed || pending}
          onClick={() => {
            if (confirm(`Simpan ${p?.inserts.length ?? 0} brand baru dan ${p?.updates.length ?? 0} perubahan?`)) run("commit");
          }}
          className={btnPrimary}
          title={previewed ? "" : "Preview dulu"}
        >
          2. Simpan (upsert)
        </button>
        <button type="button" disabled={pending} onClick={onExport} className={btnSecondary}>
          Export .xlsx
        </button>
      </div>

      {result?.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{result.error}</p>
      )}
      {result?.saved && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Tersimpan: {result.saved.inserted} brand baru, {result.saved.updated} diperbarui, {result.saved.handlers} shop
          BizDev handler diperbarui.
          {result.saved.failed.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-700">
              {result.saved.failed.map((f, i) => (
                <li key={i}>
                  {f.sheetRow ? `Baris ${f.sheetRow} ` : ""}
                  {f.brandName}: {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {p && <BulkPlanView plan={p} envRowCount={result?.envRowCount ?? 0} envLabel="environment ini" />}
    </div>
  );
}

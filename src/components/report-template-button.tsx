"use client";

import { useState, useTransition } from "react";
import { downloadBase64File, XLSX_MIME } from "@/lib/utils/download";
import {
  downloadReportCreatorTemplate,
  downloadReportSessionTemplate,
} from "@/lib/deals/report-actions";

/**
 * Unduh template .xlsx untuk upload tracking report campaign BD.
 *
 * Headernya dibangun dari daftar kolom yang sama dengan yang dibaca importer
 * (lib/deals/report-template.ts), jadi file hasil unduh bisa langsung diisi lalu
 * diunggah kembali — tanpa menebak ejaan kolom. Dipakai di detail Deal Brand dan
 * detail Project BD, karena keduanya memakai importer yang sama.
 */
export function ReportTemplateButton({
  kind,
  label,
  className = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
}: {
  kind: "session" | "creator";
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, base64 } =
          kind === "session"
            ? await downloadReportSessionTemplate()
            : await downloadReportCreatorTemplate();
        downloadBase64File(filename, base64, XLSX_MIME);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengunduh template");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={pending} className={className}>
        {pending
          ? "Menyiapkan…"
          : (label ??
            (kind === "session"
              ? "⤓ Template Report Performance"
              : "⤓ Template Creator TC & Celeb"))}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

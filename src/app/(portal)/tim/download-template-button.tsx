"use client";

import { useState, useTransition } from "react";
import { downloadBase64File, XLSX_MIME } from "@/lib/utils/download";
import { downloadTeamTemplate } from "./template-actions";

/**
 * Unduh template .xlsx untuk upload anggota tim. Header template dijamin sama
 * dengan yang dibaca parser upload, jadi file hasil download bisa langsung
 * diisi dan diunggah kembali tanpa penyesuaian.
 */
export function DownloadTeamTemplateButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, base64 } = await downloadTeamTemplate();
        downloadBase64File(filename, base64, XLSX_MIME);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengunduh template");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? "Menyiapkan..." : "Download Template"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

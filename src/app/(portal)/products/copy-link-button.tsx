"use client";

import { useEffect, useState } from "react";

/**
 * Tombol salin link produk.
 *
 * navigator.clipboard hanya tersedia di secure context (https / localhost); di
 * http biasa nilainya undefined dan tombol akan diam saja kalau tidak ditangani.
 * Karena itu ada jalur cadangan lewat textarea + execCommand supaya tim yang
 * membuka portal dari alamat internal tetap bisa menyalin.
 */
export function CopyLinkButton({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
    } catch {
      // Clipboard ditolak browser → biarkan pengguna menyalin manual lewat
      // tooltip; jangan melempar error yang mematikan render tabel.
      window.prompt("Salin link produk:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      aria-label={`Salin link produk${label ? ` ${label}` : ""}`}
      className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
        copied
          ? "border-green-300 bg-green-50 text-green-700"
          : "border-slate-200 text-slate-600 hover:bg-slate-100"
      }`}
    >
      {copied ? "tersalin" : "salin"}
    </button>
  );
}

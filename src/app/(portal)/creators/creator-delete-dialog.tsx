"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteCreators } from "./delete-actions";
import { MAX_BULK_DELETE, type DeleteReport } from "@/lib/creators/delete";

/** Kreator yang akan dihapus — id untuk aksi, label untuk ditampilkan. */
export interface DeleteTarget {
  id: string;
  label: string;
}

/** Kata yang harus diketik user untuk mengaktifkan tombol hapus. */
const CONFIRM_WORD = "HAPUS";

/** Maksimal nama yang dirinci di modal sebelum diringkas "+N lainnya". */
const PREVIEW_LIMIT = 12;

/**
 * Modal konfirmasi hapus kreator (satu baris maupun bulk).
 *
 * Penghapusan permanen, jadi user harus mengetik "HAPUS" — bukan sekadar klik
 * tombol merah — dan modal tidak bisa ditutup dengan klik latar/Escape selama
 * request berjalan. Kreator yang ditolak server (masih punya kontrak/report/
 * komisi) ditampilkan beserta alasannya, bukan hilang begitu saja.
 */
export function CreatorDeleteDialog({
  targets,
  onClose,
  onDeleted,
}: {
  targets: DeleteTarget[];
  onClose: () => void;
  /** Dipanggil dengan id yang benar-benar terhapus, supaya pemanggil bisa bersihkan centangnya. */
  onDeleted: (ids: string[]) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [report, setReport] = useState<DeleteReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Escape menutup modal — kecuali saat request berjalan atau hasil sudah tampil
  // (hasil ditutup lewat tombol "Selesai" supaya laporan penolakan terbaca).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  const tooMany = targets.length > MAX_BULK_DELETE;
  const canSubmit = confirmText.trim().toUpperCase() === CONFIRM_WORD && !pending && !tooMany;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteCreators(targets.map((t) => t.id));
        setReport(result);
        if (result.deleted.length > 0) onDeleted(result.deleted.map((d) => d.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menghapus kreator.");
      }
    });
  };

  const preview = targets.slice(0, PREVIEW_LIMIT);
  const hidden = targets.length - preview.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hapus-kreator-title"
      >
        <h2 id="hapus-kreator-title" className="text-lg font-semibold text-slate-900">
          {report ? "Hasil Hapus Kreator" : `Hapus ${targets.length} Kreator?`}
        </h2>

        {!report && (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Penghapusan bersifat <strong>permanen</strong> dan tidak bisa dibatalkan dari halaman
              ini. Data turunan upload mingguan (transaksi, agency link, status link, agregat GMV)
              ikut terhapus dan akan terbentuk lagi pada upload berikutnya.
            </p>
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Kreator yang masih punya kontrak, report terkirim, komisi akuisisi/referral, request
              campaign, jadwal live, atau akun portal <strong>akan ditolak</strong> — untuk kasus itu
              set status <strong>nonaktif</strong> saja.
            </p>

            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium text-slate-600">Akan dihapus:</p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                {preview.map((t) => (
                  <li key={t.id}>
                    {t.label} <span className="font-mono text-[10px] text-slate-400">{t.id}</span>
                  </li>
                ))}
                {hidden > 0 && <li className="text-slate-500">+{hidden} kreator lainnya</li>}
              </ul>
            </div>

            {tooMany && (
              <p className="mt-3 text-xs text-red-600">
                Maksimal {MAX_BULK_DELETE} kreator per sekali hapus (dipilih {targets.length}).
                Kurangi centangnya.
              </p>
            )}

            <label className="mt-4 block text-xs font-medium text-slate-600" htmlFor="konfirmasi-hapus">
              Ketik <span className="font-mono font-semibold">{CONFIRM_WORD}</span> untuk mengaktifkan
              tombol hapus
            </label>
            <input
              id="konfirmasi-hapus"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoComplete="off"
              placeholder={CONFIRM_WORD}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
            />

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Menghapus…" : `Hapus ${targets.length} kreator`}
              </button>
            </div>
          </>
        )}

        {report && (
          <>
            {report.deleted.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-slate-700">
                  Terhapus ({report.deleted.length})
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {report.deleted.map((d) => (
                    <li key={d.id}>
                      {d.label} <span className="font-mono text-[10px] text-slate-400">{d.id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.blocked.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-red-700">
                  Ditolak ({report.blocked.length})
                </p>
                <ul className="mt-1 space-y-1 text-xs text-slate-600">
                  {report.blocked.map((b) => (
                    <li key={`${b.id}-${b.reason}`}>
                      <span className="font-medium text-slate-800">{b.label}</span> — {b.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.deleted.length === 0 && report.blocked.length === 0 && (
              <p className="mt-3 text-sm text-slate-600">Tidak ada kreator yang diproses.</p>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
              >
                Selesai
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

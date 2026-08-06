"use client";

import { useActionState, useEffect, useState } from "react";
import { requestCmAssignment, type CmRequestState } from "./cm-request-actions";

/**
 * Tombol "Request CM" per baris tabel Kreator.
 *
 * Muncul untuk CM yang TIDAK punya izin assign (CPM): mereka tidak bisa menugaskan
 * kreator ke dirinya sendiri, jadi jalurnya mengajukan request yang diputuskan CM
 * Lead / Head. Yang sudah punya izin assign memakai tombol Edit (dropdown CM), bukan
 * ini — biar tidak ada dua jalur untuk pekerjaan yang sama.
 */
export function CmRequestButton({
  creatorId,
  creatorLabel,
  ownerName,
  alreadyRequested,
  isMine,
}: {
  creatorId: string;
  creatorLabel: string;
  /** Nama CM pemilik saat ini; null = belum ada CM (request = klaim, bukan take-over). */
  ownerName: string | null;
  /** Sudah ada request pending dari user ini untuk kreator ini. */
  alreadyRequested: boolean;
  /** Kreator sudah dipegang user ini — tombol tidak perlu ditampilkan. */
  isMine: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CmRequestState, FormData>(
    requestCmAssignment,
    null
  );

  // Tutup dialog begitu server mengonfirmasi; pesannya tetap tampil di baris.
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  if (isMine) return null;

  const sent = alreadyRequested || Boolean(state?.ok);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={sent}
        title={
          sent
            ? "Request sudah diajukan — menunggu keputusan CM Lead / Head"
            : ownerName
              ? `Ajukan pemindahan ${creatorLabel} dari ${ownerName}`
              : `Ajukan diri sebagai CM ${creatorLabel}`
        }
        className="rounded bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400"
      >
        {sent ? "Menunggu ACC" : "Request"}
      </button>

      {state && !state.ok && (
        <span className="ml-1 text-xs text-red-600" role="alert">
          {state.message}
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Request CM untuk ${creatorLabel}`}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Request pegang kreator</h2>
            <p className="mt-1 text-sm text-slate-600">
              Anda mengajukan diri sebagai CM untuk <strong>{creatorLabel}</strong>
              {ownerName ? (
                <>
                  {" "}
                  yang sekarang dipegang <strong>{ownerName}</strong>. Pemindahan baru berlaku
                  setelah disetujui CM Lead / Head.
                </>
              ) : (
                <> yang belum punya CM. Penugasan baru berlaku setelah disetujui CM Lead / Head.</>
              )}
            </p>

            <form action={formAction} className="mt-4">
              <input type="hidden" name="creator_id" value={creatorId} />
              <label className="block text-xs font-medium text-slate-600" htmlFor={`reason-${creatorId}`}>
                Alasan (opsional, membantu approver memutuskan)
              </label>
              <textarea
                id={`reason-${creatorId}`}
                name="reason"
                rows={3}
                placeholder="cth: sudah handle live-nya 2 bulan terakhir, komunikasi lewat saya"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />

              {state && !state.ok && (
                <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700">{state.message}</p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
                >
                  {pending ? "Mengirim…" : "Kirim request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

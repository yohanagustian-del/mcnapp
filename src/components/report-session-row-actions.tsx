"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteReportSession,
  updateReportSession,
  type ReportSessionFormState,
} from "@/lib/deals/report-actions";

/** Satu baris report sesi live — bentuknya sama di detail Deal Brand & detail Project BD. */
export interface ReportSessionRow {
  id: number;
  creator_name: string;
  session_date: string | null;
  event: string | null;
  support_ads: string | null;
  ads_spend_usd: number | null;
  ads_spend_idr: number | null;
  ss_link: string | null;
  gmv: number | null;
  roas: number | null;
}

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

/**
 * Tombol Edit & Hapus per baris tabel "Tracking Report Campaign (BD)".
 *
 * Dipakai bersama oleh detail Deal Brand (/deals/DEAL-xxx) dan detail Project BD
 * (/bd-projects/PRJ-xxx) — tepat satu dari `dealId`/`projectId` diisi, sama seperti
 * pemilik baris di deal_live_sessions (CLAUDE.md #4: satu implementasi).
 */
export function ReportSessionRowActions({
  session,
  dealId,
  projectId,
}: {
  session: ReportSessionRow;
  dealId?: string;
  projectId?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "edit" | "delete">("idle");
  const [editState, editAction, editPending] = useActionState<ReportSessionFormState | null, FormData>(
    updateReportSession,
    null
  );
  const [deleteState, deleteAction, deletePending] = useActionState<ReportSessionFormState | null, FormData>(
    deleteReportSession,
    null
  );

  useEffect(() => {
    if (editState?.ok) {
      setMode("idle");
      router.refresh();
    }
  }, [editState, router]);

  useEffect(() => {
    if (deleteState?.ok) {
      setMode("idle");
      router.refresh();
    }
  }, [deleteState, router]);

  const ownerHidden = dealId ? (
    <input type="hidden" name="deal_id" value={dealId} />
  ) : (
    <input type="hidden" name="project_id" value={projectId} />
  );

  return (
    <>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMode("edit")}
          className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setMode("delete")}
          className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Hapus
        </button>
      </div>

      {mode === "edit" && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit sesi live ${session.creator_name}`}
        >
          <div className="my-8 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Edit sesi live</h2>
            <form action={editAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              {ownerHidden}
              <input type="hidden" name="session_id" value={session.id} />
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Nama creator</span>
                <input
                  name="creator_name"
                  required
                  defaultValue={session.creator_name}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Tanggal session</span>
                <input
                  type="date"
                  name="session_date"
                  defaultValue={session.session_date ?? ""}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Event</span>
                <input name="event" defaultValue={session.event ?? ""} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Support Ads</span>
                <input name="support_ads" defaultValue={session.support_ads ?? ""} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Ads Spending ($)</span>
                <input
                  name="ads_spend_usd"
                  defaultValue={session.ads_spend_usd != null ? String(session.ads_spend_usd) : ""}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">IDR</span>
                <input
                  name="ads_spend_idr"
                  defaultValue={session.ads_spend_idr != null ? String(session.ads_spend_idr) : ""}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">GMV</span>
                <input
                  name="gmv"
                  required
                  defaultValue={session.gmv != null ? String(session.gmv) : ""}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">ROAS</span>
                <input
                  name="roas"
                  defaultValue={session.roas != null ? String(session.roas) : ""}
                  className={inputCls}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">SS Dashboard (link)</span>
                <input name="ss_link" defaultValue={session.ss_link ?? ""} className={inputCls} />
              </label>

              {editState && !editState.ok && (
                <p className="sm:col-span-2 mt-1 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
                  {editState.message}
                </p>
              )}

              <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setMode("idle")}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={editPending}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {editPending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Hapus sesi live ${session.creator_name}`}
        >
          <div className="my-16 w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Hapus sesi live</h2>
            <p className="mt-2 text-sm text-slate-600">
              Sesi <strong>{session.creator_name}</strong>
              {session.session_date ? ` (${session.session_date})` : ""} akan dihapus. Isi lengkapnya
              tetap tercatat di audit log.
            </p>

            <form action={deleteAction} className="mt-3">
              {ownerHidden}
              <input type="hidden" name="session_id" value={session.id} />

              {deleteState && !deleteState.ok && (
                <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
                  {deleteState.message}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMode("idle")}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={deletePending}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deletePending ? "Menghapus…" : "Hapus sesi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

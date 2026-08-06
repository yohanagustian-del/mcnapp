"use client";

import { useActionState, useState } from "react";
import type { CmRequestRow } from "@/lib/creators/cm-requests";
import { decideCmRequest, type CmRequestState } from "./cm-request-actions";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_BADGE: Record<string, string> = {
  accepted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800",
  rejected: "rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700",
  pending: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800",
};

const STATUS_LABEL: Record<string, string> = {
  accepted: "diterima",
  rejected: "ditolak",
  pending: "menunggu",
};

/** Satu baris antrean + tombol Terima/Tolak (masing-masing punya state aksinya sendiri). */
function PendingRow({ req }: { req: CmRequestRow }) {
  const [state, formAction, pending] = useActionState<CmRequestState, FormData>(decideCmRequest, null);
  const [note, setNote] = useState("");

  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-slate-800">{req.creatorLabel}</div>
        <div className="text-xs text-slate-400">{formatWhen(req.created_at)}</div>
      </td>
      <td className="px-3 py-2 text-slate-700">{req.requesterName}</td>
      <td className="px-3 py-2 text-slate-600">
        {req.currentOwnerName ?? <span className="text-amber-700">belum ada CM</span>}
      </td>
      <td className="px-3 py-2 text-slate-600">
        {req.reason ? <span className="whitespace-pre-wrap">{req.reason}</span> : "—"}
      </td>
      <td className="px-3 py-2">
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="request_id" value={req.id} />
          <input type="hidden" name="decision_note" value={note} />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan keputusan (opsional)"
            aria-label={`Catatan keputusan untuk ${req.creatorLabel}`}
            className="w-48 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              name="decision"
              value="accepted"
              disabled={pending}
              className="rounded-md bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-50"
            >
              {pending ? "…" : "Terima"}
            </button>
            <button
              type="submit"
              name="decision"
              value="rejected"
              disabled={pending}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Tolak
            </button>
          </div>
          {state && (
            <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`} role="status">
              {state.message}
            </p>
          )}
        </form>
      </td>
    </tr>
  );
}

/**
 * Panel "Request penugasan CM".
 *
 * Untuk pemegang izin `creators.decide_cm_request` (Director/Head/SPV/CM Lead):
 * antrean request dari CM lengkap dengan tombol Terima/Tolak. Menerima =
 * memindahkan kepemilikan kreator (approval, tercatat di audit_logs).
 *
 * Untuk CM biasa: panel yang sama tampil read-only sebagai status request mereka,
 * jadi mereka tidak perlu bertanya "sudah di-ACC belum?".
 */
export function CmRequestsPanel({
  pending,
  recent,
  canDecide,
  viewerId,
}: {
  pending: CmRequestRow[];
  recent: CmRequestRow[];
  canDecide: boolean;
  viewerId: string;
}) {
  // CM biasa hanya melihat request miliknya sendiri — antrean CM lain bukan urusannya.
  const visiblePending = canDecide ? pending : pending.filter((r) => r.requested_by === viewerId);
  const visibleRecent = canDecide ? recent : recent.filter((r) => r.requested_by === viewerId);

  if (visiblePending.length === 0 && visibleRecent.length === 0) return null;

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
      <h2 className="text-sm font-semibold text-sky-900">
        {canDecide
          ? `Request penugasan CM — ${visiblePending.length} menunggu keputusan`
          : "Request penugasan CM Anda"}
      </h2>
      <p className="mt-1 text-xs text-sky-900">
        {canDecide ? (
          <>
            CPM tidak bisa menugaskan kreator ke dirinya sendiri, jadi mereka mengajukan request di
            sini. <strong>Terima</strong> memindahkan kepemilikan kreator ke CM pengaju dan tercatat
            di audit log sebagai approval; request lain untuk kreator yang sama otomatis ditutup.
          </>
        ) : (
          <>
            Status pengajuan Anda. Pemindahan kreator baru berlaku setelah disetujui CM Lead / Head —
            selama masih “menunggu”, kepemilikan belum berubah.
          </>
        )}
      </p>

      {visiblePending.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-sky-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-sky-100 text-left text-xs uppercase text-sky-900">
              <tr>
                <th className="px-3 py-2">Kreator</th>
                <th className="px-3 py-2">Pengaju</th>
                <th className="px-3 py-2">CM sekarang</th>
                <th className="px-3 py-2">Alasan</th>
                <th className="px-3 py-2">{canDecide ? "Keputusan" : "Status"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100">
              {visiblePending.map((req) =>
                canDecide ? (
                  <PendingRow key={req.id} req={req} />
                ) : (
                  <tr key={req.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">{req.creatorLabel}</td>
                    <td className="px-3 py-2 text-slate-700">{req.requesterName}</td>
                    <td className="px-3 py-2 text-slate-600">{req.currentOwnerName ?? "belum ada CM"}</td>
                    <td className="px-3 py-2 text-slate-600">{req.reason ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={STATUS_BADGE.pending}>menunggu</span>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {visibleRecent.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-sky-900 underline">
            Keputusan terakhir ({visibleRecent.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {visibleRecent.map((r) => (
              <li key={r.id}>
                <span className={STATUS_BADGE[r.status] ?? STATUS_BADGE.pending}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>{" "}
                <strong>{r.creatorLabel}</strong> → {r.requesterName}
                {r.deciderName && <> · oleh {r.deciderName}</>} · {formatWhen(r.decided_at)}
                {r.decision_note && <> · “{r.decision_note}”</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

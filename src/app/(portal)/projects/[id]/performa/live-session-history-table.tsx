"use client";

import { useState, useTransition } from "react";
import { voidLiveSession } from "./live-actions";

export interface LiveSessionHistoryRow {
  id: number;
  creatorName: string;
  creatorUsername: string | null;
  sessionDate: string;
  sessionNo: number;
  gmv: number;
  gmvTrend: number | null;
  orders: number;
  attributionStatus: string;
  filenameProduct: string | null;
  filenameTrend: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  verified: "Terverifikasi", confirmed_manual: "Dikonfirmasi tim", disputed: "Disanggah", voided: "Dibatalkan",
};
const STATUS_STYLES: Record<string, string> = {
  verified: "bg-green-100 text-green-800", confirmed_manual: "bg-amber-100 text-amber-800",
  disputed: "bg-red-100 text-red-800", voided: "bg-slate-200 text-slate-500",
};

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Riwayat sesi live per project (PR-10) — Batalkan sesi → voided + recompute. */
export function LiveSessionHistoryTable({
  rows, canManage,
}: { rows: LiveSessionHistoryRow[]; canManage: boolean }) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function onVoid(id: number) {
    if (!confirm("Batalkan sesi ini? GMV-nya langsung keluar dari roll-up project.")) return;
    setPendingId(id);
    const fd = new FormData();
    fd.set("session_id", String(id));
    startTransition(async () => {
      await voidLiveSession(fd);
      setPendingId(null);
    });
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Kreator</th>
            <th className="px-4 py-3">Tanggal</th>
            <th className="px-4 py-3">Sesi</th>
            <th className="px-4 py-3">GMV</th>
            <th className="px-4 py-3">Order</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">File</th>
            {canManage && <th className="px-4 py-3">Aksi</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2 font-medium">
                {r.creatorName}
                {r.creatorUsername && <span className="ml-1 text-xs text-slate-400">@{r.creatorUsername}</span>}
              </td>
              <td className="px-4 py-2">{r.sessionDate}</td>
              <td className="px-4 py-2">#{r.sessionNo}</td>
              <td className="px-4 py-2">
                {rupiah(r.gmv)}
                {r.gmvTrend !== null && <span className="ml-1 text-xs text-slate-400">(trend {rupiah(r.gmvTrend)})</span>}
              </td>
              <td className="px-4 py-2">{r.orders}</td>
              <td className="px-4 py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.attributionStatus] ?? ""}`}>
                  {STATUS_LABELS[r.attributionStatus] ?? r.attributionStatus}
                </span>
              </td>
              <td className="px-4 py-2 text-xs text-slate-400">
                {r.filenameProduct ?? "—"}{r.filenameTrend ? ` + ${r.filenameTrend}` : ""}
              </td>
              {canManage && (
                <td className="px-4 py-2">
                  {r.attributionStatus !== "voided" && (
                    <button
                      onClick={() => onVoid(r.id)} disabled={pending && pendingId === r.id}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Batalkan
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={canManage ? 8 : 7} className="px-4 py-6 text-center text-slate-400">
                Belum ada sesi live tercatat.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

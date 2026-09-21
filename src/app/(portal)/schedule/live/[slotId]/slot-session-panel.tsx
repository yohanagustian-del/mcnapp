"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateSlotReport, voidSlotLiveSession } from "./actions";

export interface SlotSessionRow {
  id: number;
  sessionNo: number;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  gmv: number;
  gmvTrend: number | null;
  orders: number;
  brand: string | null;
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

/**
 * Daftar sesi live milik satu slot + tombol Generate Report. Dipisah dari
 * halaman (server component) karena kedua aksi mengembalikan hasil yang perlu
 * ditampilkan, bukan sekadar redirect.
 */
export function SlotSessionPanel({
  slotId, rows, canEdit, canGenerate, reportId,
}: {
  slotId: number;
  rows: SlotSessionRow[];
  canEdit: boolean;
  canGenerate: boolean;
  reportId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onVoid(id: number) {
    if (!confirm("Batalkan sesi ini? Angkanya langsung keluar dari report slot ini.")) return;
    const fd = new FormData();
    fd.set("session_id", String(id));
    startTransition(async () => {
      const res = await voidSlotLiveSession(fd);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function onGenerate() {
    setError(null);
    const fd = new FormData();
    fd.set("slot_id", String(slotId));
    startTransition(async () => {
      const res = await generateSlotReport(fd);
      if (!res.ok) { setError(res.error); return; }
      router.push(`/schedule/live/${slotId}/report`);
    });
  }

  const countable = rows.filter(
    (r) => r.attributionStatus === "verified" || r.attributionStatus === "confirmed_manual"
  );

  return (
    <div className="mt-3 space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Sesi</th>
              <th className="px-4 py-3">Tanggal</th>
              <th className="px-4 py-3">Jam</th>
              <th className="px-4 py-3">GMV</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">File</th>
              {canEdit && <th className="px-4 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">#{r.sessionNo}</td>
                <td className="px-4 py-2">{r.sessionDate}</td>
                <td className="px-4 py-2 text-slate-500">
                  {r.startTime && r.endTime ? `${r.startTime.slice(0, 5)}–${r.endTime.slice(0, 5)}` : "—"}
                </td>
                <td className="px-4 py-2">
                  {rupiah(r.gmv)}
                  {r.gmvTrend !== null && (
                    <span className="text-xs text-slate-400"> (trend {rupiah(r.gmvTrend)})</span>
                  )}
                </td>
                <td className="px-4 py-2">{r.orders}</td>
                <td className="px-4 py-2">{r.brand ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.attributionStatus] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABELS[r.attributionStatus] ?? r.attributionStatus}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">
                  {r.filenameProduct ?? "—"}
                  {r.filenameTrend ? ` · ${r.filenameTrend}` : ""}
                </td>
                {canEdit && (
                  <td className="px-4 py-2">
                    {r.attributionStatus !== "voided" && (
                      <button type="button" onClick={() => onVoid(r.id)} disabled={pending}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
                        Batalkan
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className="px-4 py-6 text-center text-slate-400">
                  Belum ada data sesi untuk slot ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {canGenerate && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onGenerate} disabled={pending || countable.length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {reportId ? "Segarkan Report" : "Generate Report"}
          </button>
          <span className="text-xs text-slate-500">
            {countable.length === 0
              ? "Unggah minimal satu sesi dulu."
              : `${countable.length} sesi dihitung. Angka diambil dari data sesi — 0 token AI.`}
          </span>
        </div>
      )}
    </div>
  );
}

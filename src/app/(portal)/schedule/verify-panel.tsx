"use client";

import { useState, useTransition } from "react";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import { verifySlotAction, cancelVerifiedSlotAction } from "./actions";

const input = "rounded-md border border-slate-300 px-2 py-1 text-xs";
const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

export interface VerifyRow {
  slot: LiveScheduleSlot;
  creatorName: string;
}

/** Form aktif dalam satu baris verifikasi: live (jam aktual) atau tidak jadi (alasan). */
type RowMode = "live" | "cancelled";

function LiveVerifyForm({ row, onDone }: { row: VerifyRow; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { slot } = row;

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await verifySlotAction(formData);
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <>
      <form action={onSubmit} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="slot_id" value={slot.id} />
        <input type="time" name="actual_start" required className={input} />
        <span className="text-xs text-slate-400">s/d</span>
        <input type="time" name="actual_end" required className={input} />
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" name="pk_ready" defaultChecked={slot.pk_ready} /> PK
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" name="product_connected_tap" defaultChecked={slot.product_connected_tap} /> TAP
        </label>
        <button type="submit" disabled={pending} className={`${btnSmall} bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50`}>
          {pending ? "..." : "Verifikasi"}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </>
  );
}

function CancelVerifyForm({ row, onDone }: { row: VerifyRow; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { slot } = row;

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await cancelVerifiedSlotAction(formData);
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <>
      <form action={onSubmit} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="slot_id" value={slot.id} />
        <input
          type="text"
          name="cancel_reason"
          required
          placeholder="Alasan tidak jadi live"
          className={`${input} w-48`}
        />
        <button
          type="submit"
          disabled={pending}
          className={`${btnSmall} bg-red-700 text-white hover:bg-red-800 disabled:opacity-50`}
        >
          {pending ? "..." : "Tandai Tidak Jadi"}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </>
  );
}

function VerifyRowForm({ row, onDone }: { row: VerifyRow; onDone: () => void }) {
  const [mode, setMode] = useState<RowMode>("live");
  const { slot } = row;
  const rencana =
    slot.start_time && slot.end_time ? `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}` : "—";

  return (
    <tr>
      <td className="px-3 py-2 font-medium">{row.creatorName}</td>
      <td className="px-3 py-2">{slot.brand_name?.trim() || "Organik"}</td>
      <td className="px-3 py-2">{slot.schedule_date}</td>
      <td className="px-3 py-2">{rencana}</td>
      <td className="px-3 py-2">
        <div className="mb-1 flex gap-3 text-[11px]">
          <label className="flex items-center gap-1 text-slate-600">
            <input
              type="radio"
              name={`mode-${slot.id}`}
              checked={mode === "live"}
              onChange={() => setMode("live")}
            />
            Live
          </label>
          <label className="flex items-center gap-1 text-red-700">
            <input
              type="radio"
              name={`mode-${slot.id}`}
              checked={mode === "cancelled"}
              onChange={() => setMode("cancelled")}
            />
            Tidak jadi live
          </label>
        </div>
        {mode === "live" ? (
          <LiveVerifyForm row={row} onDone={() => onDone()} />
        ) : (
          <CancelVerifyForm row={row} onDone={() => onDone()} />
        )}
      </td>
    </tr>
  );
}

export function VerifyPanel({
  todayRows,
  overdueRows,
}: {
  todayRows: VerifyRow[];
  overdueRows: VerifyRow[];
}) {
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());

  function markDone(id: number) {
    setDoneIds((prev) => new Set(prev).add(id));
  }

  const visibleToday = todayRows.filter((r) => !doneIds.has(r.slot.id));
  const visibleOverdue = overdueRows.filter((r) => !doneIds.has(r.slot.id));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Kreator</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Tanggal</th>
              <th className="px-3 py-2">Jam Rencana</th>
              <th className="px-3 py-2">Verifikasi Aktual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleToday.map((r) => (
              <VerifyRowForm key={r.slot.id} row={r} onDone={() => markDone(r.slot.id)} />
            ))}
            {visibleToday.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-center text-slate-400">
                  Tidak ada slot hari ini yang perlu diverifikasi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {visibleOverdue.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-red-700">Terlewat belum diverifikasi</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-red-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-red-50 text-left text-xs uppercase text-red-700">
                <tr>
                  <th className="px-3 py-2">Kreator</th>
                  <th className="px-3 py-2">Brand</th>
                  <th className="px-3 py-2">Tanggal</th>
                  <th className="px-3 py-2">Jam Rencana</th>
                  <th className="px-3 py-2">Verifikasi Aktual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleOverdue.map((r) => (
                  <VerifyRowForm key={r.slot.id} row={r} onDone={() => markDone(r.slot.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

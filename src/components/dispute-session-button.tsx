"use client";

import { useState, useTransition } from "react";
import { disputeLiveSession } from "@/app/portal/projects/live-dispute-actions";

/** "Ini bukan data saya" (§10.3) — inline reason required before submitting. */
export function DisputeSessionButton({ sessionId }: { sessionId: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return <span className="text-xs text-slate-400">Sanggahan terkirim — menunggu tim.</span>;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-red-700 hover:underline">
        Ini bukan data saya
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <input
        value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Kenapa sesi ini bukan milikmu?"
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() => {
            if (!reason.trim()) { setError("Alasan wajib diisi"); return; }
            setError(null);
            const fd = new FormData();
            fd.set("session_id", String(sessionId));
            fd.set("reason", reason.trim());
            startTransition(async () => {
              try {
                await disputeLiveSession(fd);
                setDone(true);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Gagal mengirim sanggahan");
              }
            });
          }}
          className="rounded-md bg-red-700 px-2 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          Kirim sanggahan
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">Batal</button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

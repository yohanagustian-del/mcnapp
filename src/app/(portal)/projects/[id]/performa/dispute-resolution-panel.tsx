"use client";

import { useState, useTransition } from "react";
import { reassignLiveSession, rejectLiveSessionDispute } from "./live-actions";

export interface DisputedSessionRow {
  id: number;
  creatorId: string;
  creatorName: string;
  sessionDate: string;
  sessionNo: number;
  gmv: number;
  brand: string | null;
  disputeReason: string | null;
  disputedAt: string | null;
}

export interface ReassignTargetOption {
  creatorId: string;
  name: string;
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Resolusi sanggahan sesi (PRD §10.3/PR-26): Pindahkan ke peserta lain atau Tolak sanggahan. */
export function DisputeResolutionPanel({
  rows, targets,
}: { rows: DisputedSessionRow[]; targets: ReassignTargetOption[] }) {
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [reasonDraft, setReasonDraft] = useState<Record<number, string>>({});
  const [targetDraft, setTargetDraft] = useState<Record<number, string>>({});

  if (rows.length === 0) return null;

  function onReject(id: number) {
    const reason = (reasonDraft[id] ?? "").trim();
    if (!reason) {
      setErrors((e) => ({ ...e, [id]: "Alasan menolak sanggahan wajib diisi" }));
      return;
    }
    setPendingId(id);
    const fd = new FormData();
    fd.set("session_id", String(id));
    fd.set("reason", reason);
    startTransition(async () => {
      const res = await rejectLiveSessionDispute(fd);
      setErrors((e) => ({ ...e, [id]: res.ok ? "" : res.error ?? "Gagal" }));
      setPendingId(null);
    });
  }

  function onReassign(id: number) {
    const targetCreatorId = targetDraft[id];
    if (!targetCreatorId) {
      setErrors((e) => ({ ...e, [id]: "Pilih peserta tujuan dulu" }));
      return;
    }
    setPendingId(id);
    const fd = new FormData();
    fd.set("session_id", String(id));
    fd.set("target_creator_id", targetCreatorId);
    startTransition(async () => {
      const res = await reassignLiveSession(fd);
      setErrors((e) => ({ ...e, [id]: res.ok ? "" : res.error ?? "Gagal" }));
      setPendingId(null);
    });
  }

  return (
    <div className="mt-6">
      <h2 className="text-lg font-medium">Sanggahan Menunggu ({rows.length})</h2>
      <div className="mt-2 space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
            <p className="font-medium">
              {r.creatorName} · {r.sessionDate} · Sesi #{r.sessionNo} · {rupiah(r.gmv)}
              {r.brand && <span className="ml-1 text-xs text-slate-500">({r.brand})</span>}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Alasan kreator: {r.disputeReason ?? "—"}
              {r.disputedAt && <span className="text-slate-400"> · {new Date(r.disputedAt).toLocaleString("id-ID")}</span>}
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <select
                  value={targetDraft[r.id] ?? ""}
                  onChange={(e) => setTargetDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">Pindahkan ke peserta…</option>
                  {targets.filter((t) => t.creatorId !== r.creatorId).map((t) => (
                    <option key={t.creatorId} value={t.creatorId}>{t.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => onReassign(r.id)} disabled={pending && pendingId === r.id}
                  className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Pindahkan
                </button>
              </div>
              <div className="space-y-1">
                <input
                  value={reasonDraft[r.id] ?? ""}
                  onChange={(e) => setReasonDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                  placeholder="Alasan menolak sanggahan"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                />
                <button
                  onClick={() => onReject(r.id)} disabled={pending && pendingId === r.id}
                  className="w-full rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  Tolak Sanggahan
                </button>
              </div>
            </div>
            {errors[r.id] && <p className="mt-2 text-xs text-red-700">{errors[r.id]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

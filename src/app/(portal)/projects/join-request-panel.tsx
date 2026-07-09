"use client";

import { useState, useTransition } from "react";
import { decideProjectJoinRequest } from "./actions";

export interface JoinRequestRow {
  id: number;
  projectId: number;
  projectName: string;
  creatorId: string;
  creatorName: string;
  createdAt: string;
}

function JoinRequestCard({ row, onDone }: { row: JoinRequestRow; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "diterima" | "ditolak") {
    setError(null);
    const formData = new FormData();
    formData.set("request_id", String(row.id));
    formData.set("decision", decision);
    startTransition(async () => {
      const res = await decideProjectJoinRequest(formData);
      if (res.ok) {
        onDone();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div>
        <p className="font-medium">{row.creatorName} <span className="text-xs text-slate-400">{row.creatorId}</span></p>
        <p className="text-xs text-slate-500">Mengajukan ikut: {row.projectName}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("diterima")}
          className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
        >
          {pending ? "..." : "Terima"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("ditolak")}
          className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
        >
          {pending ? "..." : "Tolak"}
        </button>
      </div>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** M9 §2.6 — pending creator join requests for special projects; PM/lead decides here. */
export function JoinRequestPanel({ rows }: { rows: JoinRequestRow[] }) {
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());
  const visible = rows.filter((r) => !doneIds.has(r.id));

  if (visible.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">Tidak ada pengajuan bergabung yang menunggu.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {visible.map((row) => (
        <JoinRequestCard key={row.id} row={row} onDone={() => setDoneIds((prev) => new Set(prev).add(row.id))} />
      ))}
    </div>
  );
}

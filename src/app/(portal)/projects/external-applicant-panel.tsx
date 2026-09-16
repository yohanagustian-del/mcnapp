"use client";

import { useState, useTransition } from "react";
import { decideExternalApplicant } from "./actions";

export interface ExternalApplicantRow {
  id: number;
  projectId: number;
  projectName: string;
  fullName: string;
  username: string;
  platform: string;
  followers: number | null;
  niche: string | null;
  createdAt: string;
}

function ApplicantCard({ row, onDone }: { row: ExternalApplicantRow; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [targetGmv, setTargetGmv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    setError(null);
    if (decision === "rejected" && !reason.trim()) { setRejecting(true); return; }
    const formData = new FormData();
    formData.set("applicant_id", String(row.id));
    formData.set("decision", decision);
    if (decision === "rejected") formData.set("reason", reason.trim());
    if (decision === "approved" && targetGmv.trim()) formData.set("target_gmv", targetGmv.trim());
    startTransition(async () => {
      const res = await decideExternalApplicant(formData);
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div>
        <p className="font-medium">
          {row.fullName} <span className="text-xs text-slate-400">@{row.username} · {row.platform}</span>
        </p>
        <p className="text-xs text-slate-500">
          Daftar publik ke: {row.projectName}
          {row.niche ? ` · ${row.niche}` : ""}
          {row.followers ? ` · ${row.followers.toLocaleString("id-ID")} followers` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={targetGmv} onChange={(e) => setTargetGmv(e.target.value)}
          placeholder="Target GMV (opsional)"
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <button type="button" disabled={pending} onClick={() => decide("approved")}
          className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50">
          {pending ? "..." : "Terima"}
        </button>
        <button type="button" disabled={pending} onClick={() => decide("rejected")}
          className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50">
          {pending ? "..." : "Tolak"}
        </button>
      </div>
      {rejecting && (
        <div className="flex w-full items-center gap-2">
          <input
            value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder="Alasan penolakan (wajib)"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <button type="button" disabled={pending || !reason.trim()} onClick={() => decide("rejected")}
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50">
            Konfirmasi Tolak
          </button>
        </div>
      )}
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Pendaftar Eksternal (dari link publik /join/{slug}) — R15/§6.6. */
export function ExternalApplicantPanel({ rows }: { rows: ExternalApplicantRow[] }) {
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());
  const visible = rows.filter((r) => !doneIds.has(r.id));

  if (visible.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">Tidak ada pendaftar eksternal yang menunggu.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {visible.map((row) => (
        <ApplicantCard key={row.id} row={row} onDone={() => setDoneIds((prev) => new Set(prev).add(row.id))} />
      ))}
    </div>
  );
}

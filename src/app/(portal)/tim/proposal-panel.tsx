"use client";

import { useActionState, useState } from "react";
import {
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATUS_LABELS,
  summarizeProposal,
  type ProposalKind,
} from "@/lib/tim/member-admin";
import { decideProposal, type ProposalActionState } from "./member-actions";

export interface ProposalRow {
  id: number;
  kind: ProposalKind;
  target_label: string;
  payload: Record<string, unknown>;
  reason: string;
  status: string;
  requested_by_label: string;
  requested_at: string;
  decision_note: string | null;
}

const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Satu usulan OD + keputusan Director. Menyetujui langsung menjalankan perubahannya
 * (aksi Director berlaku seketika); menolak hanya menutup usulan.
 */
function ProposalCard({ proposal }: { proposal: ProposalRow }) {
  const [note, setNote] = useState("");
  const [state, action, pending] = useActionState<ProposalActionState, FormData>(
    decideProposal,
    null
  );

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {PROPOSAL_KIND_LABELS[proposal.kind]}
          </span>
          <p className="mt-1.5 text-sm font-medium text-slate-800">
            {summarizeProposal(proposal.kind, proposal.target_label, proposal.payload)}
          </p>
        </div>
        <p className="text-[11px] text-slate-400">{formatDate(proposal.requested_at)}</p>
      </div>

      <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium">Alasan OD:</span> {proposal.reason}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">Diajukan oleh {proposal.requested_by_label}</p>

      <form action={action} className="mt-3">
        <input type="hidden" name="request_id" value={proposal.id} />
        <label className="block text-xs font-medium text-slate-600" htmlFor={`note-${proposal.id}`}>
          Catatan keputusan (opsional)
        </label>
        <input
          id={`note-${proposal.id}`}
          name="decision_note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputCls}
        />

        {state && !state.ok && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
        {state?.ok && state.tempPassword && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Password sementara — tampil sekali ini saja</p>
            <p className="mt-1 break-all font-mono text-sm">{state.tempPassword}</p>
            <p className="mt-1">
              Kirim ke <strong>{state.tempPasswordEmail}</strong> lewat kanal pribadi.
            </p>
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="submit"
            name="decision"
            value="rejected"
            disabled={pending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Tolak
          </button>
          <button
            type="submit"
            name="decision"
            value="approved"
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Memproses…" : "Setujui & jalankan"}
          </button>
        </div>
      </form>
    </li>
  );
}

/** Antrean usulan OD di halaman Tim — hanya dirender untuk Director. */
export function ProposalPanel({
  pending,
  decided,
}: {
  pending: ProposalRow[];
  decided: ProposalRow[];
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">
        Usulan dari OD{" "}
        {pending.length > 0 && (
          <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {pending.length} menunggu
          </span>
        )}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        OD tidak bisa mengubah data tim sendiri. Perubahan baru berlaku setelah Anda menyetujuinya di
        sini.
      </p>

      {pending.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
          Tidak ada usulan yang menunggu.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {pending.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-500">
            Riwayat usulan ({decided.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {decided.map((p) => (
              <li key={p.id} className="rounded-md border border-slate-100 bg-white px-3 py-2 text-xs">
                <span className="font-medium text-slate-700">
                  {PROPOSAL_STATUS_LABELS[p.status] ?? p.status}
                </span>{" "}
                — {summarizeProposal(p.kind, p.target_label, p.payload)}
                <span className="ml-1 text-slate-400">({formatDate(p.requested_at)})</span>
                {p.decision_note && (
                  <span className="block text-slate-500">Catatan: {p.decision_note}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

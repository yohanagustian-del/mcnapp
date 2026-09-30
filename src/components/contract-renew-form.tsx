"use client";

import { useState, useTransition } from "react";
import { renewContractAction } from "@/app/(portal)/workspace/acquisition/perpanjangan/actions";

const input = "rounded-md border border-slate-300 px-2 py-1 text-xs";
const btn = "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50";

/**
 * Shared "Perpanjang" form — the ONLY UI for renewing a creator contract, rendered by
 * Perpanjangan Kreator and (per row) CM Workspace. Always submits via
 * renewContractAction (scope-checked with assertCreatorInScope, CLAUDE.md #4).
 */
export function ContractRenewForm({
  creatorId,
  contractEndDate,
  onDone,
}: {
  creatorId: string;
  /** Current contract end (ISO date); the new period defaults to start the day after. */
  contractEndDate: string | null;
  /** Called after a successful renewal (e.g. to close the form / mark the row). */
  onDone?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const defaultStart = contractEndDate
    ? new Date(new Date(contractEndDate).getTime() + 86_400_000).toISOString().slice(0, 10)
    : "";

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await renewContractAction(formData);
      if (res.ok) onDone?.();
      else setError(res.error);
    });
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <form action={onSubmit} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="creator_id" value={creatorId} />
        <label className="text-[11px] text-slate-500">
          Mulai
          <input type="date" name="start_date" required defaultValue={defaultStart} className={`${input} block`} />
        </label>
        <label className="text-[11px] text-slate-500">
          Akhir Baru
          <input type="date" name="end_date" required className={`${input} block`} />
        </label>
        <label className="text-[11px] text-slate-500">
          Catatan (opsional)
          <input type="text" name="notes" className={`${input} block w-48`} />
        </label>
        <button type="submit" disabled={pending} className={btn}>
          {pending ? "..." : "Simpan Perpanjangan"}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setMeaBudgetAction } from "../actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

export function MeaBudgetForm({
  month,
  creators,
}: {
  month: string;
  creators: { id: string; name: string; username: string | null }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(fd: FormData) {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const res = await setMeaBudgetAction(fd);
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <input type="hidden" name="month" value={month} />
      <label className="text-xs text-slate-600">
        Kreator (ID)
        <input name="creator_id" list="mea-budget-creators" required placeholder="CRT-…" className={`${input} block w-56`} />
        <datalist id="mea-budget-creators">
          {creators.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.username ? ` @${c.username}` : ""}</option>
          ))}
        </datalist>
      </label>
      <label className="text-xs text-slate-600">
        Jatah bulan {month} (Rp)
        <input name="budget" required inputMode="numeric" placeholder="mis. 2.000.000" className={`${input} block w-40`} />
      </label>
      <label className="text-xs text-slate-600">
        Catatan
        <input name="note" className={`${input} block w-56`} />
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "…" : "Simpan Jatah"}
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
      {done && <p className="w-full text-xs text-green-700">Jatah tersimpan.</p>}
    </form>
  );
}

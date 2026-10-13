"use client";

import { useActionState, useEffect, useState } from "react";
import { MAX_BIZDEV_HANDLERS } from "@/lib/deals/bizdev-handler-spec";
import type { BizdevMember } from "@/lib/deals/bizdev-handlers";
import { setBrandBizdevHandlers, type BizdevHandlerFormState } from "./bizdev-handler-actions";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

/**
 * Tombol "BizDev" per baris tabel Shop: pilih maks 2 BizDev penanggung jawab brand.
 * Kosongkan keduanya = brand jadi "Non BD Handle".
 */
export function BizdevHandlerButton({
  shopKey,
  shopLabel,
  current,
  members,
}: {
  shopKey: string;
  shopLabel: string;
  current: BizdevMember[];
  members: BizdevMember[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<BizdevHandlerFormState | null, FormData>(
    setBrandBizdevHandlers,
    null
  );
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1 rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
      >
        BizDev
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`BizDev brand ${shopLabel}`}
        >
          <div className="my-8 w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">BizDev penanggung jawab</h2>
            <p className="mt-1 text-sm text-slate-600">{shopLabel}</p>
            <form action={formAction} className="mt-4 space-y-3">
              <input type="hidden" name="shop_key" value={shopKey} />
              {Array.from({ length: MAX_BIZDEV_HANDLERS }, (_, i) => (
                <label key={i} className="block">
                  <span className="text-xs font-medium text-slate-600">BizDev {i + 1}</span>
                  <select name="member_id" defaultValue={current[i]?.id ?? ""} className={inputCls}>
                    <option value="">— kosong —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p className="text-xs text-slate-500">
                Maksimal {MAX_BIZDEV_HANDLERS} BizDev per brand. Kosongkan keduanya untuk menandai brand
                sebagai <strong>Non BD Handle</strong>.
              </p>
              {state && !state.ok && (
                <p className="rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
                  {state.message}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {pending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

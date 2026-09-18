"use client";

import { useActionState } from "react";
import { createApproach, type ApproachFormState } from "./actions";
import { ApproachFields } from "./approach-fields";

export function ApproachCreateForm() {
  const [state, formAction, pending] = useActionState<ApproachFormState | null, FormData>(createApproach, null);
  const today = new Date().toISOString().slice(0, 10);
  const err = (field: string) => state?.fieldErrors?.[field];

  return (
    <form action={formAction} className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {state && (
        <p className={`rounded-md p-3 text-sm ${state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {state.message}
        </p>
      )}

      <ApproachFields defaults={{ scouting_date: today }} err={err} />

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menyimpan..." : "Catat"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { markLeadConverted, type LeadFormState } from "../actions";

export function ConvertToDealForm({ leadId }: { leadId: string }) {
  const action = async (_prev: LeadFormState | null, formData: FormData): Promise<LeadFormState> => {
    const dealId = String(formData.get("deal_id") ?? "");
    return markLeadConverted(leadId, dealId);
  };
  const [state, formAction, pending] = useActionState<LeadFormState | null, FormData>(action, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="deal_id"
        required
        placeholder="DEAL-XXXXX"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menandai..." : "Tandai sudah jadi Deal"}
      </button>
      {state && (
        <span className={`text-xs ${state.ok ? "text-green-700" : "text-amber-700"}`}>{state.message}</span>
      )}
    </form>
  );
}

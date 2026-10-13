"use client";

import { useActionState } from "react";
import { generateBrandReportV2, type BrandReportActionState } from "./actions";

/** Satu shop hasil pencarian → generate Report Brand v2 (ads spend opsional). */
export function GenerateBrandReportForm({
  platform,
  shopId,
  period,
}: {
  platform: string;
  shopId: string;
  period: string;
}) {
  const [state, action, pending] = useActionState<BrandReportActionState | null, FormData>(generateBrandReportV2, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="shop_id" value={shopId} />
      <input type="hidden" name="period" value={period} />
      <input
        name="ads_spend"
        inputMode="numeric"
        placeholder="Ads spend brand (opsional)"
        className="w-52 rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Membuat…" : "Generate Report"}
      </button>
      {state && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </form>
  );
}

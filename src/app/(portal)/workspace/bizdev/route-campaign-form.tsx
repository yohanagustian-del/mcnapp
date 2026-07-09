"use client";

import { useActionState } from "react";
import { routeCampaignRequest, type RouteActionState } from "../campaign-actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

export function RouteCampaignForm({ deals }: { deals: { id: string; brand_name: string }[] }) {
  const [state, action, pending] = useActionState<RouteActionState | null, FormData>(
    routeCampaignRequest,
    null
  );

  return (
    <form action={action} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="deal_id" required className={input}>
          <option value="">— deal / brand —</option>
          {deals.map((d) => <option key={d.id} value={d.id}>{d.brand_name} ({d.id})</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="needs_brand_acc" className="h-4 w-4" />
          Brand minta acc creator dulu (per campaign — LOCKED §6.2)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
          <input type="checkbox" name="creator_direct" className="h-4 w-4" />
          Creator dicarikan BizDev langsung (tanpa CM) — konfirmasi CM dilewati, tercatat
          sebagai kontribusi BizDev
        </label>
      </div>
      <textarea name="creator_ids" required rows={2}
        placeholder="Creator ID, pisah koma/spasi (mis. CRT-00789, CRT-00790) — bisa dibantu Matching M5 / Prediksi M6"
        className={input} />
      <input name="notes" placeholder="Catatan untuk CM" className={input} />
      <button type="submit" disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "Routing…" : "Route ke CM Pemilik Creator"}
      </button>
      {state && (
        <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-600"}`}>{state.message}</p>
      )}
    </form>
  );
}

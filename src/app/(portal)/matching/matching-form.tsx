"use client";

import { useActionState } from "react";
import { ProductMatchView } from "@/components/product-match-view";
import { runMatching, type MatchingActionResult } from "./actions";

/** Creator Product Match (M5, satu engine): pilih kreator → profil kategori + produk cocok. 0 token AI. */
export function MatchingForm({ creators }: { creators: { id: string; name: string }[] }) {
  const [result, formAction, pending] = useActionState<MatchingActionResult | null, FormData>(
    runMatching,
    null
  );

  return (
    <div>
      <form
        action={formAction}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <select name="creator_id" required className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">— Pilih kreator —</option>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.id})
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Mencocokkan..." : "Cocokkan Produk"}
        </button>
        <span className="text-xs text-slate-500">
          AOV kreator per kategori → segmen harga → produk TAP/PX kategori & segmen sama, urut order. Deterministik, 0 token AI.
        </span>
      </form>

      {result && (
        <div className="mt-4">
          <div
            className={`rounded-md p-3 text-sm ${
              result.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
            }`}
          >
            {result.message}
          </div>
          <div className="mt-3">
            <ProductMatchView result={result.result} />
          </div>
        </div>
      )}
    </div>
  );
}

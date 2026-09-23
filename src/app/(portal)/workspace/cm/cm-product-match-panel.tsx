"use client";

import { useActionState } from "react";
import { ProductMatchView } from "@/components/product-match-view";
import type { ProductMatchResult } from "@/lib/product-match/engine";
import { loadCmProductMatch } from "./product-match-actions";

interface PanelState {
  ok: boolean;
  message: string;
  creatorId: string | null;
  result: ProductMatchResult | null;
}

const INITIAL_STATE: PanelState = { ok: true, message: "", creatorId: null, result: null };

async function runProductMatch(_prev: PanelState, formData: FormData): Promise<PanelState> {
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  if (!creatorId) return { ok: false, message: "Pilih kreator terlebih dahulu.", creatorId: null, result: null };
  try {
    const result = await loadCmProductMatch(creatorId);
    return { ok: true, message: "", creatorId, result };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Gagal memuat produk cocok.",
      creatorId,
      result: null,
    };
  }
}

/** Seksi "Produk Cocok per Kreator" CM Workspace — daftar kreator scope CM, klik → panel hasil. */
export function CmProductMatchPanel({ creators }: { creators: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<PanelState, FormData>(runProductMatch, INITIAL_STATE);
  const creatorName = state.creatorId ? creators.find((c) => c.id === state.creatorId)?.name ?? state.creatorId : null;

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <select name="creator_id" required className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">— Pilih kreator —</option>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Memuat..." : "Lihat Produk Cocok"}
        </button>
      </form>

      {!state.ok && state.message && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">{state.message}</p>
      )}

      {state.result && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">{creatorName}</p>
          <ProductMatchView result={state.result} />
        </div>
      )}
    </div>
  );
}

"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProjectShopBudget, type ProjectFormState } from "../actions";
import type { ProjectShopRow } from "./project-shops-table";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

/**
 * Modal Edit Ads Budget & Service Fee untuk satu shop DALAM satu project.
 *
 * Nilai yang diketik di sini hanya berlaku untuk pasangan (project ini, shop ini):
 * barisnya disimpan di bd_project_shop_budgets, jadi shop yang sama di project lain
 * tidak ikut berubah (migrasi 0046). Tabel shop di tab Deal Brand menampilkan JUMLAH
 * nominal ini lintas project.
 *
 * Inilah satu-satunya tempat kedua nominal ini diisi: form Registrasi Deal, upload
 * deal, tab Produk TAP, dan form Edit shop di tab Deal Brand tidak menyentuhnya.
 */
export function ShopBudgetEditButton({
  shop,
  projectId,
  projectName,
}: {
  shop: ProjectShopRow;
  projectId: string;
  /** Dipakai di judul modal supaya jelas nominalnya milik project yang mana. */
  projectName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ProjectFormState | null, FormData>(
    updateProjectShopBudget,
    null
  );

  useEffect(() => {
    if (!state?.ok) return;
    setOpen(false);
    router.refresh();
  }, [state, router]);

  const err = (field: string) => state?.fieldErrors?.[field];
  const shopLabel = shop.shop_name ?? shop.shop_key;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        Edit
      </button>

      {state && !state.ok && !open && (
        <span className="ml-1 text-xs text-red-600" role="alert">
          {state.message}
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit nominal shop ${shopLabel} di project ${projectName ?? projectId}`}
        >
          <div className="my-8 w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Edit Ads Budget &amp; Service Fee</h2>
            <p className="mt-1 text-sm text-slate-600">
              {shopLabel} <span className="text-slate-400">·</span> project{" "}
              <strong>{projectName ?? projectId}</strong>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Angka di bawah hanya berlaku untuk <strong>shop ini di project ini</strong> — shop yang
              sama di project lain punya angkanya sendiri, dan tab Deal Brand menampilkan totalnya.
              Kosongkan salah satu kolom = jangan ubah kolom itu.
            </p>

            <form action={formAction} className="mt-4">
              <input type="hidden" name="shop_key" value={shop.shop_key} />
              <input type="hidden" name="project_id" value={projectId} />

              <label className="block">
                <span className="text-xs font-medium text-slate-600">Ads Budget (Rp)</span>
                <input
                  name="ads_budget"
                  type="number"
                  min="0"
                  defaultValue={shop.ads_budget != null ? String(Math.round(shop.ads_budget)) : ""}
                  placeholder="50000000"
                  className={inputCls}
                />
                {err("ads_budget") && (
                  <span className="mt-1 block text-xs text-red-600">{err("ads_budget")}</span>
                )}
              </label>

              <label className="mt-3 block">
                <span className="text-xs font-medium text-slate-600">Service Fee (Rp)</span>
                <input
                  name="service_fee"
                  type="number"
                  min="0"
                  defaultValue={shop.service_fee != null ? String(Math.round(shop.service_fee)) : ""}
                  placeholder="5000000"
                  className={inputCls}
                />
                {err("service_fee") && (
                  <span className="mt-1 block text-xs text-red-600">{err("service_fee")}</span>
                )}
              </label>

              {state && !state.ok && (
                <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
                  {state.message}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
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

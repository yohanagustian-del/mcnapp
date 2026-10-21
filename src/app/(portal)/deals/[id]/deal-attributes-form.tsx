"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEAL_STATUS_OPTIONS, normalizeDealStatus } from "@/lib/deals/deal-status";
import { updateDealAttributes, type AttributeFormState } from "./attribute-actions";

// Nilai = CHECK brand_deals_support_types_check (0097); label = kolom sheet.
const SUPPORT_CHOICES = [
  { value: "sample", label: "Sample" },
  { value: "flash_sale", label: "Flash Sale" },
  { value: "ads", label: "Ads" },
];
const NEW_NICHE = "__new__"; // = NEW_NICHE_VALUE di lib/deals/deal-attributes

export interface DealAttributeValues {
  status: string | null;
  niche: string | null;
  leads_type: string | null;
  support_types: string[] | null;
  priority: string | null;
  working_sheet: string | null;
  campaign_ops_id: string | null;
}

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

/**
 * Form "Edit Status & Atribut" di detail Deal Brand. Pilihan niche/leads dari
 * app_config; nilai lama di luar daftar tetap ditampilkan supaya tidak hilang diam-diam.
 */
export function DealAttributesForm({
  dealId,
  values,
  nicheOptions,
  leadsOptions,
  campaignOps,
  canAddNiche,
}: {
  dealId: string;
  values: DealAttributeValues;
  nicheOptions: string[];
  leadsOptions: string[];
  campaignOps: { id: string; name: string }[];
  canAddNiche: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [niche, setNiche] = useState(values.niche ?? "");
  const [state, formAction, pending] = useActionState<AttributeFormState | null, FormData>(updateDealAttributes, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const err = (f: string) => state?.fieldErrors?.[f];
  const withCurrent = (list: string[], cur: string | null) => (cur && !list.includes(cur) ? [cur, ...list] : list);

  if (!open) {
    return (
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
        >
          Edit Status &amp; Atribut
        </button>
        {state?.ok && <span className="text-xs text-green-700">{state.message}</span>}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <input type="hidden" name="deal_id" value={dealId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Status</span>
          <select name="status" defaultValue={normalizeDealStatus(values.status) ?? ""} className={inputCls}>
            <option value="">— kosong —</option>
            {DEAL_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {err("status") && <span className="mt-1 block text-xs text-red-600">{err("status")}</span>}
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-600">Niche</span>
          <select name="niche" value={niche} onChange={(e) => setNiche(e.target.value)} className={inputCls}>
            <option value="">— kosong —</option>
            {withCurrent(nicheOptions, values.niche).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            {canAddNiche && <option value={NEW_NICHE}>+ Tambah niche baru…</option>}
          </select>
          {niche === NEW_NICHE && (
            <input name="new_niche" placeholder="Nama niche baru" maxLength={60} className={inputCls} />
          )}
          {err("niche") && <span className="mt-1 block text-xs text-red-600">{err("niche")}</span>}
          {err("new_niche") && <span className="mt-1 block text-xs text-red-600">{err("new_niche")}</span>}
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-600">Leads</span>
          <select name="leads_type" defaultValue={values.leads_type ?? ""} className={inputCls}>
            <option value="">— kosong —</option>
            {withCurrent(leadsOptions, values.leads_type).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {err("leads_type") && <span className="mt-1 block text-xs text-red-600">{err("leads_type")}</span>}
        </label>

        <fieldset className="block">
          <span className="text-xs font-medium text-slate-600">Sample / Flash Sale / Ads</span>
          <div className="mt-2 flex gap-4">
            {SUPPORT_CHOICES.map((c) => (
              <label key={c.value} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="support_types"
                  value={c.value}
                  defaultChecked={(values.support_types ?? []).includes(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
          {err("support_types") && <span className="mt-1 block text-xs text-red-600">{err("support_types")}</span>}
        </fieldset>

        <label className="block">
          <span className="text-xs font-medium text-slate-600">Campaign Ops</span>
          <select name="campaign_ops_id" defaultValue={values.campaign_ops_id ?? ""} className={inputCls}>
            <option value="">Non Campaign Ops</option>
            {campaignOps.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {err("campaign_ops_id") && <span className="mt-1 block text-xs text-red-600">{err("campaign_ops_id")}</span>}
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-600">Prioritas</span>
          <input name="priority" defaultValue={values.priority ?? ""} className={inputCls} />
        </label>

        <label className="block sm:col-span-2 lg:col-span-3">
          <span className="text-xs font-medium text-slate-600">Working Sheet (link)</span>
          <input name="working_sheet" defaultValue={values.working_sheet ?? ""} className={inputCls} />
        </label>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Ads Brand tidak diedit di sini — atur Ads Support per shop di detail Project BD.
      </p>
      {state && !state.ok && (
        <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">{state.message}</p>
      )}
      {state?.ok && <p className="mt-3 text-sm text-green-700">{state.message}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Tutup
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
  );
}

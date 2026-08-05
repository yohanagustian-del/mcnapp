"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { parseCommission } from "@/lib/utils/commission";
import { updateDeal } from "./actions";
import type { DealFormState } from "./actions";
import type { DealRow } from "./deals-table";

const STATUS_OPTIONS = ["running", "hold", "done"] as const;
const CAMPAIGN_TYPE_OPTIONS = [
  { value: "paid", label: "Paid campaign" },
  { value: "sample", label: "Campaign sample (non-berbayar)" },
  { value: "extra_commission", label: "Komisi extra (non-berbayar)" },
] as const;

const labelCls = "block text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

/**
 * Nilai awal komisi min/max untuk form: `komisi_*_pct` adalah hasil parse saat ingest,
 * tapi baris legacy bisa punya raw "5-7%" yang batas atasnya tidak disimpan di kolom
 * mana pun — jadi raw di-parse ulang untuk mengisi kolom Max.
 */
function commissionDefaults(
  raw: string | null,
  pct: number | null
): { min: string; max: string } {
  const parsed = parseCommission(raw);
  const min = pct ?? parsed?.min ?? null;
  const max = parsed?.isRange ? parsed.max : null;
  return { min: min != null ? String(min) : "", max: max != null ? String(max) : "" };
}

function Field({
  id,
  label,
  error,
  required = false,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  );
}

/**
 * Tombol Edit + modal untuk satu baris Deal Brand.
 *
 * Form yang sama ketatnya dengan registrasi deal (CLAUDE.md #6): shop_id numeric,
 * exp_date dari date picker, komisi angka % (range = min & max terpisah), Rupiah
 * angka murni. Kolom yang belum diketahui boleh dikosongkan → tersimpan null dan
 * ditandai flag review, bukan diisi karangan.
 */
export function DealEditButton({ deal }: { deal: DealRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<DealFormState | null, FormData>(
    updateDeal,
    null
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const err = (field: string) => state?.fieldErrors?.[field];
  const kreator = commissionDefaults(deal.komisi_kreator_raw, deal.komisi_kreator_pct);
  const mea = commissionDefaults(deal.komisi_mea_raw, deal.komisi_mea_pct);
  const fid = (name: string) => `${name}-${deal.id}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-8 w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Edit Deal Brand</h2>
                <p className="text-xs text-slate-500">
                  {deal.brand_name}
                  <span className="ml-1 font-mono text-[10px] text-slate-400">{deal.id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            <form action={action} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <input type="hidden" name="deal_id" value={deal.id} />

              <Field
                id={fid("brand_name")}
                label="Nama Brand (sesuai display platform)"
                required
                error={err("brand_name")}
                className="col-span-2"
              >
                <input
                  id={fid("brand_name")}
                  name="brand_name"
                  required
                  defaultValue={deal.brand_name}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("shop_id")} label="Shop ID (angka)" error={err("shop_id")}>
                <input
                  id={fid("shop_id")}
                  name="shop_id"
                  inputMode="numeric"
                  pattern="\d*"
                  placeholder="7495123456789"
                  defaultValue={deal.shop_id ?? ""}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("niche")} label="Niche" error={err("niche")}>
                <input
                  id={fid("niche")}
                  name="niche"
                  placeholder="Beauty / FMCG / Fashion…"
                  defaultValue={deal.niche ?? ""}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("exp_date")} label="Exp Date (→ deal_end)" error={err("exp_date")}>
                <input
                  id={fid("exp_date")}
                  name="exp_date"
                  type="date"
                  defaultValue={deal.exp_date ?? ""}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("status")} label="Status">
                <select
                  id={fid("status")}
                  name="status"
                  defaultValue={deal.status ?? ""}
                  className={inputCls}
                >
                  <option value="">—</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>

              <Field
                id={fid("komisi_kreator_min")}
                label="Komisi Kreator % — min"
                error={err("komisi_kreator_min")}
              >
                <input
                  id={fid("komisi_kreator_min")}
                  name="komisi_kreator_min"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={kreator.min}
                  className={inputCls}
                />
              </Field>
              <Field
                id={fid("komisi_kreator_max")}
                label="Komisi Kreator % — max (kosong bila bukan range)"
                error={err("komisi_kreator_max")}
              >
                <input
                  id={fid("komisi_kreator_max")}
                  name="komisi_kreator_max"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={kreator.max}
                  className={inputCls}
                />
              </Field>
              <Field
                id={fid("komisi_mea_min")}
                label="Komisi MEA % — min"
                error={err("komisi_mea_min")}
              >
                <input
                  id={fid("komisi_mea_min")}
                  name="komisi_mea_min"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={mea.min}
                  className={inputCls}
                />
              </Field>
              <Field
                id={fid("komisi_mea_max")}
                label="Komisi MEA % — max (kosong bila bukan range)"
                error={err("komisi_mea_max")}
              >
                <input
                  id={fid("komisi_mea_max")}
                  name="komisi_mea_max"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={mea.max}
                  className={inputCls}
                />
              </Field>

              <Field id={fid("campaign_name")} label="Campaign Name" error={err("campaign_name")}>
                <input
                  id={fid("campaign_name")}
                  name="campaign_name"
                  defaultValue={deal.campaign_name ?? ""}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("campaign_type")} label="Tipe Campaign">
                <select
                  id={fid("campaign_type")}
                  name="campaign_type"
                  defaultValue={deal.campaign_type ?? "paid"}
                  className={inputCls}
                >
                  {CAMPAIGN_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field id={fid("ads_budget")} label="Ads Budget (Rp)" error={err("ads_budget")}>
                <input
                  id={fid("ads_budget")}
                  name="ads_budget"
                  type="number"
                  min="0"
                  defaultValue={deal.ads_budget ?? ""}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("service_fee")} label="Service Fee (Rp)" error={err("service_fee")}>
                <input
                  id={fid("service_fee")}
                  name="service_fee"
                  type="number"
                  min="0"
                  defaultValue={deal.service_fee ?? ""}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("gmv_tap")} label="GMV TAP (Rp)" error={err("gmv_tap")}>
                <input
                  id={fid("gmv_tap")}
                  name="gmv_tap"
                  type="number"
                  min="0"
                  defaultValue={deal.gmv_tap ?? ""}
                  className={inputCls}
                />
              </Field>
              <Field id={fid("avg_price")} label="Avg Harga (Rp)" error={err("avg_price")}>
                <input
                  id={fid("avg_price")}
                  name="avg_price"
                  type="number"
                  min="0"
                  defaultValue={deal.avg_price ?? ""}
                  className={inputCls}
                />
              </Field>

              <Field id={fid("notes")} label="Catatan" className="col-span-full">
                <textarea
                  id={fid("notes")}
                  name="notes"
                  rows={2}
                  defaultValue={deal.notes ?? ""}
                  className={inputCls}
                />
              </Field>

              <p className="col-span-full rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                Exp Date ikut mengisi <span className="font-medium">deal_end</span> shop (alert
                kadaluarsa M4). Kolom yang belum diketahui boleh dikosongkan — tersimpan kosong dan
                ditandai flag review, jangan diisi perkiraan. Status link kreator tidak bisa diedit
                di sini: diisi engine M4 dari upload mingguan.
              </p>

              {state && !state.ok && (
                <p className="col-span-full text-xs text-red-600">{state.message}</p>
              )}

              <div className="col-span-full mt-1 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
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

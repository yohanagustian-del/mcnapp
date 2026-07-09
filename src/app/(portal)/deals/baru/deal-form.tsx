"use client";

import { useActionState, useState } from "react";
import { registerDeal, type DealFormState } from "../actions";

interface PicOption {
  id: string;
  name: string;
}

export function DealForm({ picOptions }: { picOptions: PicOption[] }) {
  const [state, formAction, pending] = useActionState<DealFormState | null, FormData>(
    registerDeal,
    null
  );
  const [productRows, setProductRows] = useState(1);

  const err = (field: string) => state?.fieldErrors?.[field];

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      {state && (
        <p
          className={`rounded-md p-3 text-sm ${
            state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </p>
      )}

      <Field label="Nama Brand (sesuai display platform)" error={err("brand_name")}>
        <input name="brand_name" required className={inputCls} placeholder="cth: Skintific Official Store" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Shop ID (angka)" error={err("shop_id")}>
          <input name="shop_id" required inputMode="numeric" pattern="\d+" className={inputCls} placeholder="7495123456789" />
        </Field>
        <Field label="Niche" error={err("niche")}>
          <input name="niche" required className={inputCls} placeholder="Beauty / FMCG / Fashion..." />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Exp Date (durasi deal → deal_end)" error={err("exp_date")}>
          <input name="exp_date" type="date" required className={inputCls} />
        </Field>
        <Field label="PIC TAP" error={err("pic_tap")}>
          <select name="pic_tap" required className={inputCls} defaultValue="">
            <option value="" disabled>Pilih PIC…</option>
            {picOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium">Komisi Kreator (%)</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min" error={err("komisi_kreator_min")}>
            <input name="komisi_kreator_min" type="number" step="0.1" min="0" max="100" required className={inputCls} />
          </Field>
          <Field label="Max (kosongkan bila bukan range)" error={err("komisi_kreator_max")}>
            <input name="komisi_kreator_max" type="number" step="0.1" min="0" max="100" className={inputCls} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium">Komisi MEA (%)</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min" error={err("komisi_mea_min")}>
            <input name="komisi_mea_min" type="number" step="0.1" min="0" max="100" required className={inputCls} />
          </Field>
          <Field label="Max (kosongkan bila bukan range)" error={err("komisi_mea_max")}>
            <input name="komisi_mea_max" type="number" step="0.1" min="0" max="100" className={inputCls} />
          </Field>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Campaign Name" error={err("campaign_name")}>
          <input name="campaign_name" required className={inputCls} />
        </Field>
        <Field label="Tipe Campaign" error={err("campaign_type")}>
          <select name="campaign_type" className={inputCls} defaultValue="paid">
            <option value="paid">Paid campaign</option>
            <option value="sample">Campaign sample (non-berbayar)</option>
            <option value="extra_commission">Komisi extra (non-berbayar)</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Ads Budget (Rp, angka murni — opsional)" error={err("ads_budget")}>
          <input name="ads_budget" type="number" min="0" className={inputCls} placeholder="50000000" />
        </Field>
        <Field label="Service Fee (Rp, angka murni — opsional)" error={err("service_fee")}>
          <input name="service_fee" type="number" min="0" className={inputCls} />
        </Field>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium">
          Daftar Produk (1 brand boleh mendaftarkan &gt;1 produk)
        </legend>
        <div className="space-y-3">
          {Array.from({ length: productRows }).map((_, i) => (
            <div key={i} className="grid grid-cols-3 gap-3">
              <Field label={i === 0 ? "Product ID" : ""}>
                <input name="product_id[]" className={inputCls} placeholder="1729384756" />
              </Field>
              <Field label={i === 0 ? "Nama Produk" : ""}>
                <input name="product_name[]" className={inputCls} placeholder="Serum Vit C 30ml" />
              </Field>
              <Field label={i === 0 ? "Link Produk" : ""}>
                <input name="product_link[]" type="url" className={inputCls} placeholder="https://..." />
              </Field>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setProductRows((n) => n + 1)}
            className="rounded-md bg-slate-100 px-3 py-1.5 text-xs hover:bg-slate-200"
          >
            + Tambah produk
          </button>
          {productRows > 1 && (
            <button
              type="button"
              onClick={() => setProductRows((n) => Math.max(1, n - 1))}
              className="rounded-md bg-slate-100 px-3 py-1.5 text-xs hover:bg-slate-200"
            >
              − Hapus baris terakhir
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Produk mewarisi niche, exp date & komisi deal. Bulk banyak produk? Pakai upload
          excel di bawah form.
        </p>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <Field label="GMV TAP (Rp, angka murni — opsional)" error={err("gmv_tap")}>
          <input name="gmv_tap" type="number" min="0" className={inputCls} placeholder="1075484867" />
        </Field>
        <Field label="Avg Harga (Rp, angka murni — opsional)" error={err("avg_price")}>
          <input name="avg_price" type="number" min="0" className={inputCls} />
        </Field>
      </div>

      <Field label="Link Brand (opsional)" error={err("brand_link")}>
        <input name="brand_link" type="url" className={inputCls} placeholder="https://..." />
      </Field>

      <Field label="Catatan (opsional)">
        <textarea name="notes" rows={3} className={inputCls} />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menyimpan..." : "Simpan Deal"}
      </button>
    </form>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {error && <span className="mt-1 block text-xs font-normal text-red-600">{error}</span>}
    </label>
  );
}

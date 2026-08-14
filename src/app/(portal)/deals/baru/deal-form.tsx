"use client";

import { useActionState, useState } from "react";
import { registerDealCard, type DealFormState } from "../actions";
import { CAMPAIGN_TYPES, CAMPAIGN_TYPE_NEEDS_BUDGET } from "@/lib/deals/campaign-type";

export interface MemberOption {
  id: string;
  name: string;
  /** Divisi untuk optgroup ("CM" / "BizDev"); kosong = tanpa pengelompokan. */
  group?: string;
}

/**
 * Form Registrasi Deal = kartu produk untuk tab Produk TAP.
 *
 * Pertanyaannya sengaja memakai nama kolom export TAP "Export link" persis seperti
 * yang tampil di tabel Produk TAP, supaya BizDev bisa menyalin isian langsung dari
 * file/room campaign tanpa menerjemahkan istilah.
 *
 * Hanya Product Name yang wajib. Ads Budget & Service Fee baru muncul (dan baru
 * wajib) saat Tipe Campaign = komisi extra — aturan yang sama divalidasi ulang di
 * server lewat productCardIssues, bukan hanya di sini.
 */
export function DealForm({
  picOptions,
  dealByOptions,
}: {
  picOptions: MemberOption[];
  dealByOptions: MemberOption[];
}) {
  const [state, formAction, pending] = useActionState<DealFormState | null, FormData>(
    registerDealCard,
    null
  );
  const [campaignType, setCampaignType] = useState("");

  const err = (field: string) => state?.fieldErrors?.[field];
  const needsBudget = campaignType === CAMPAIGN_TYPE_NEEDS_BUDGET;

  const dealByGroups = [...new Set(dealByOptions.map((o) => o.group ?? ""))];

  return (
    <form action={formAction} className="max-w-3xl space-y-5">
      {state && (
        <p
          className={`rounded-md p-3 text-sm ${
            state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Campaign ID" error={err("campaign_id")}>
          <input name="campaign_id" className={inputCls} placeholder="7662920044527912724" />
        </Field>
        <Field label="Product Name *" error={err("product_name")}>
          <input name="product_name" required className={inputCls} placeholder="Serum Vit C 30ml" />
        </Field>
        <Field label="Product ID" error={err("product_id")}>
          <input name="product_id" inputMode="numeric" className={inputCls} placeholder="1729859716545022432" />
        </Field>
        <Field label="Sale Price (Rp, angka murni)" error={err("price")}>
          <input name="price" type="number" min="0" step="1" className={inputCls} placeholder="231000" />
        </Field>
        <Field label="Shop Name" error={err("shop_name")}>
          <input name="shop_name" className={inputCls} placeholder="Skintific Official Store" />
        </Field>
        <Field label="Shop ID" error={err("shop_id")}>
          <input name="shop_id" inputMode="numeric" className={inputCls} placeholder="7495123456789" />
        </Field>
        <Field label="Product Effective Start Time" error={err("effective_start")}>
          <input name="effective_start" type="date" className={inputCls} />
        </Field>
        <Field label="Product Effective End Time" error={err("effective_end")}>
          <input name="effective_end" type="date" className={inputCls} />
        </Field>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium">Commission Rate (%)</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Creator Commission Rate" error={err("commission_pct")}>
            <input name="commission_pct" type="number" step="0.1" min="0" max="100" className={inputCls} />
          </Field>
          <Field label="Affiliate Partner Commission Rate" error={err("partner_commission_pct")}>
            <input name="partner_commission_pct" type="number" step="0.1" min="0" max="100" className={inputCls} />
          </Field>
          <Field label="Creator Shop Ads Commission Rate" error={err("creator_shop_ads_commission_pct")}>
            <input name="creator_shop_ads_commission_pct" type="number" step="0.1" min="0" max="100" className={inputCls} />
          </Field>
          <Field label="Affiliate Partner Shop Ads Commission Rate" error={err("partner_shop_ads_commission_pct")}>
            <input name="partner_shop_ads_commission_pct" type="number" step="0.1" min="0" max="100" className={inputCls} />
          </Field>
        </div>
      </fieldset>

      <Field label="Product Link" error={err("product_link")}>
        <input name="product_link" type="url" className={inputCls} placeholder="https://..." />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tipe Campaign" error={err("campaign_type")}>
          <select
            name="campaign_type"
            value={campaignType}
            onChange={(e) => setCampaignType(e.target.value)}
            className={inputCls}
          >
            <option value="">Pilih tipe campaign…</option>
            {CAMPAIGN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deal by" error={err("deal_by")}>
          <select name="deal_by" defaultValue="" className={inputCls}>
            <option value="">Pilih nama…</option>
            {dealByGroups.map((g) => (
              <optgroup key={g} label={g || "Lainnya"}>
                {dealByOptions
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>

      {/* Ads Budget & Service Fee hanya relevan untuk komisi extra — pertanyaannya
          tidak dirender sama sekali di tipe lain, jadi nilainya tidak ikut terkirim. */}
      {needsBudget && (
        <fieldset className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <legend className="px-1 text-sm font-medium">Wajib untuk komisi extra (non-berbayar)</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Ads Budget (Rp, angka murni) *" error={err("ads_budget")}>
              <input name="ads_budget" type="number" min="0" required className={inputCls} placeholder="50000000" />
            </Field>
            <Field label="Service Fee (Rp, angka murni) *" error={err("service_fee")}>
              <input name="service_fee" type="number" min="0" required className={inputCls} placeholder="5000000" />
            </Field>
          </div>
        </fieldset>
      )}

      <Field label="PIC TAP" error={err("pic_tap")}>
        <select name="pic_tap" defaultValue="" className={inputCls}>
          <option value="">Pilih PIC…</option>
          {picOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">
        Hanya <strong>Product Name</strong> yang wajib diisi; sisanya boleh menyusul dan bisa
        diperbaiki lewat tombol Edit di tab Produk TAP. Kolom <strong>Nama BD</strong> terisi
        otomatis dari akun Anda, dan <strong>Segmen Harga</strong> dihitung server dari Sale Price
        memakai threshold app_config. Kartu tanpa Product ID tetap tersimpan, tapi ditandai
        &ldquo;perlu review&rdquo; karena tidak bisa dicocokkan dengan data TAP mingguan.
      </p>

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

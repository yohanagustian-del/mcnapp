"use client";

import { useActionState, useEffect, useState } from "react";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_NEEDS_BUDGET,
  CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL,
} from "@/lib/deals/campaign-type";
import { updateProduct, type ProductEditState } from "./actions";
import type { MemberOption, ProductRow } from "./products-table";

const inputClass = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
  type,
  required,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
  hint?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        name={name}
        type={type}
        min={type === "number" ? 0 : undefined}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={inputClass}
      />
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

/** Dropdown anggota tim; "" = kosongkan kolomnya. */
function MemberSelect({
  label,
  name,
  defaultValue,
  options,
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: MemberOption[];
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select name={name} defaultValue={defaultValue} className={inputClass}>
        <option value="">— kosongkan —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

/**
 * Modal edit satu baris Produk TAP.
 *
 * Yang bisa diubah: atribut MASTER produk (nama, shop, kategori, harga, rate komisi,
 * link, aktif) + dimensi kartu deal (tipe campaign, Ads Budget, Service Fee, Deal by,
 * PIC TAP, dan — khusus role BizDev ke atas — Nama BD pemilik baris). Ads Budget &
 * Service Fee wajib saat Tipe Campaign = Paid Campaign; aturannya sama persis dengan
 * form Registrasi Deal dan divalidasi ulang server lewat productCardIssues, jadi
 * `required` di bawah hanya mempercepat umpan balik. Metrik performa hasil upload sengaja
 * tidak ada di form ini, karena satu-satunya sumbernya adalah file export platform.
 * Segmen harga tidak diisi manual: server menghitungnya ulang dari harga memakai
 * threshold app_config.
 */
export function ProductEditButton({
  product,
  members,
  canSeeOwner,
}: {
  product: ProductRow;
  /** Anggota tim aktif untuk dropdown Deal by / PIC TAP / Nama BD. */
  members: MemberOption[];
  canSeeOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Tipe campaign dipegang di state karena dua isian di bawahnya (Ads Budget &
  // Service Fee) ikut wajib/tidak mengikuti pilihannya.
  const [campaignType, setCampaignType] = useState(product.campaign_type ?? "");
  const [state, formAction, pending] = useActionState<ProductEditState, FormData>(updateProduct, null);
  const needsBudget = campaignType === CAMPAIGN_TYPE_NEEDS_BUDGET;

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  // "Deal by" dibatasi CM & BizDev (yang menutup deal); PIC TAP & Nama BD boleh
  // siapa saja yang aktif — pembatasan divisinya sudah ditentukan server.
  const dealByOptions = members.filter((m) => m.canDealBy);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Kembalikan ke nilai tersimpan: modal yang pernah dibatalkan tidak boleh
          // membuka lagi dengan pilihan tipe campaign yang tidak jadi disimpan.
          setCampaignType(product.campaign_type ?? "");
          setOpen(true);
        }}
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
          aria-label={`Edit produk ${product.product_name ?? product.product_id}`}
        >
          <div className="my-8 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Edit produk</h2>
            <p className="mt-1 font-mono text-xs text-slate-400">{product.product_id}</p>

            <form action={formAction} className="mt-4">
              <input type="hidden" name="product_id" value={product.product_id} />
              {/* Kunci baris = (campaign_id, product_id) sejak 0040 — tanpa ini
                  update akan menyasar seluruh campaign untuk produk yang sama. */}
              <input type="hidden" name="campaign_id" value={product.campaign_id ?? "-"} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Nama produk" name="product_name" defaultValue={product.product_name ?? ""} />
                </div>
                <Field label="Shop ID" name="shop_id" defaultValue={product.shop_id ?? ""} />
                <Field label="Nama shop" name="shop_name" defaultValue={product.shop_name ?? ""} />
                <Field
                  label="Kategori Level 1"
                  name="level1_category"
                  defaultValue={product.level1_category ?? ""}
                />
                <Field
                  label="Kategori Level 2"
                  name="level2_category"
                  defaultValue={product.level2_category ?? ""}
                />
                <Field
                  label="Harga satuan"
                  name="price"
                  defaultValue={product.price != null ? String(product.price) : ""}
                  placeholder="cth: 231000 atau Rp231.000"
                  hint="Segmen harga dihitung otomatis dari nilai ini (threshold app_config)."
                />
                <Field
                  label="Komisi kreator (%)"
                  name="commission_pct"
                  defaultValue={product.commission_pct != null ? String(product.commission_pct) : ""}
                  placeholder="cth: 12 atau 5-7"
                />
                <Field
                  label="Komisi partner (%)"
                  name="partner_commission_pct"
                  defaultValue={
                    product.partner_commission_pct != null ? String(product.partner_commission_pct) : ""
                  }
                  placeholder="cth: 3"
                />
                <div className="sm:col-span-2">
                  <Field label="Link produk" name="product_link" defaultValue={product.product_link ?? ""} />
                </div>
              </div>

              <fieldset className="mt-4 rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-xs font-medium text-slate-600">Kartu deal</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">Tipe Campaign</span>
                    <select
                      name="campaign_type"
                      value={campaignType}
                      onChange={(e) => setCampaignType(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">— kosongkan —</option>
                      {CAMPAIGN_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* Selalu dirender (bukan hanya saat wajib) supaya nominal yang
                      sudah terlanjur terisi bisa DIKOSONGKAN saat tipe campaign
                      dipindah ke non-berbayar. */}
                  <Field
                    label={`Ads Budget (Rp)${needsBudget ? " *" : ""}`}
                    name="ads_budget"
                    type="number"
                    required={needsBudget}
                    defaultValue={product.ads_budget != null ? String(product.ads_budget) : ""}
                    placeholder="50000000"
                    hint={needsBudget ? `Wajib untuk ${CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL}.` : undefined}
                  />
                  <Field
                    label={`Service Fee (Rp)${needsBudget ? " *" : ""}`}
                    name="service_fee"
                    type="number"
                    required={needsBudget}
                    defaultValue={product.service_fee != null ? String(product.service_fee) : ""}
                    placeholder="5000000"
                    hint={needsBudget ? `Wajib untuk ${CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL}.` : undefined}
                  />
                  <MemberSelect
                    label="Deal by"
                    name="deal_by"
                    defaultValue={product.deal_by ?? ""}
                    options={dealByOptions}
                  />
                  <MemberSelect
                    label="PIC TAP"
                    name="pic_tap"
                    defaultValue={product.pic_tap ?? ""}
                    options={members}
                  />
                  {/* Nama BD = pemilik baris. Hanya role yang boleh melihat kolomnya
                      yang boleh memindahkannya; server menolak isian dari role lain. */}
                  {canSeeOwner && (
                    <MemberSelect
                      label="Nama BD (pemilik baris)"
                      name="uploaded_by"
                      defaultValue={product.uploaded_by ?? ""}
                      options={members}
                      hint="Ganti hanya kalau baris ini memang dipegang akun lain."
                    />
                  )}
                </div>
              </fieldset>

              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="active" defaultChecked={product.active} className="h-4 w-4" />
                Produk aktif
              </label>

              <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
                Metrik performa (Affiliate GMV, orders, items sold, jumlah kreator, komisi nominal)
                tidak bisa diedit di sini — semuanya berasal dari file export platform. Perbaiki di
                sumbernya lalu upload ulang.
              </p>

              {state && !state.ok && (
                <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{state.message}</p>
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

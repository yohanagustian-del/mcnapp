"use client";

import { useActionState, useEffect, useState } from "react";
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
 * link, aktif) + kepemilikan kartu deal (Deal by, PIC TAP, dan — khusus role BizDev
 * ke atas — Nama BD pemilik baris). Tipe Campaign, Ads Budget, dan Service Fee TIDAK
 * diedit dari sini: Tipe Campaign diseragamkan per shop di tab Deal Brand, sedangkan
 * Ads Budget & Service Fee dikelola per shop di tab Project BD. Metrik performa hasil
 * upload sengaja tidak ada di form ini, karena satu-satunya sumbernya adalah file
 * export platform. Segmen harga tidak diisi manual: server menghitungnya ulang dari
 * harga memakai threshold app_config.
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
  const [state, formAction, pending] = useActionState<ProductEditState, FormData>(updateProduct, null);

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
                <p className="mb-2 text-[11px] text-slate-400">
                  Tipe Campaign diseragamkan per shop di tab <strong>Deal Brand</strong>; Ads Budget
                  &amp; Service Fee dikelola per shop di tab <strong>Project BD</strong>.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

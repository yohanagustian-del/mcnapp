"use client";

import { useActionState, useEffect, useState } from "react";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_LABEL,
  CAMPAIGN_TYPE_NEEDS_BUDGET,
  CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL,
} from "@/lib/deals/campaign-type";
import { updateShopCards } from "./actions";
import type { DealFormState } from "./actions";
import type { ShopSummaryRow } from "./shops-table";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

/**
 * Modal Edit untuk satu baris tabel "Shop dari Produk TAP".
 *
 * Yang diedit di sini bukan "baris shop" — baris itu cuma ringkasan — melainkan
 * SELURUH kartu produk shop tersebut di tab Produk TAP sekaligus. Karena itu tiap
 * isian menyebut jumlah kartu yang akan tersentuh: mengisi Shop ID di sini mengisi
 * Shop ID semua produknya, memilih Tipe Campaign mengubah tipe semua kartunya.
 *
 * Hanya dua kolom itu yang bisa diseragamkan. Harga, komisi, dan masa berlaku
 * berbeda per produk, jadi menyamaratakannya justru merusak data — perbaikannya
 * lewat tombol Edit per baris di tab Produk TAP.
 *
 * Ads Budget & Service Fee muncul saat Paid Campaign dipilih, dan nominalnya HANYA
 * mengisi kartu yang kolomnya masih kosong: menimpa serempak dengan satu angka akan
 * melipatgandakan total shop di kolom ringkasan. Wajibnya mengikuti hitungan kartu
 * kosong dari view; server memvalidasi ulang lewat aturan yang sama.
 */
export function ShopEditButton({ shop }: { shop: ShopSummaryRow }) {
  const [open, setOpen] = useState(false);
  const [campaignType, setCampaignType] = useState("");
  const [state, formAction, pending] = useActionState<DealFormState | null, FormData>(
    updateShopCards,
    null
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  const needsBudget = campaignType === CAMPAIGN_TYPE_NEEDS_BUDGET;
  const err = (field: string) => state?.fieldErrors?.[field];
  const shopLabel = shop.shop_name ?? shop.shop_key;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Modal yang pernah dibatalkan tidak boleh terbuka lagi membawa pilihan
          // tipe campaign yang tidak jadi disimpan.
          setCampaignType("");
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
          aria-label={`Edit shop ${shopLabel}`}
        >
          <div className="my-8 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Edit shop</h2>
            <p className="mt-1 text-sm text-slate-600">{shopLabel}</p>
            <p className="mt-1 text-xs text-slate-400">
              Perubahan di sini berlaku untuk <strong>{shop.product_count} kartu produk</strong> shop
              ini di tab Produk TAP.
            </p>

            <form action={formAction} className="mt-4">
              <input type="hidden" name="shop_key" value={shop.shop_key} />

              <label className="block">
                <span className="text-xs font-medium text-slate-600">Shop ID (angka)</span>
                <input
                  name="shop_id"
                  inputMode="numeric"
                  defaultValue={shop.shop_id ?? ""}
                  placeholder="7495123456789"
                  className={inputCls}
                />
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {shop.shop_id_missing > 0
                    ? `${shop.shop_id_missing} dari ${shop.product_count} kartu belum punya Shop ID — isian ini mengisi semuanya.`
                    : "Diisikan ke semua kartu produk shop ini."}
                  {shop.shop_id_count > 1 &&
                    ` Saat ini shop ini memakai ${shop.shop_id_count} Shop ID berbeda; menyimpan akan menyeragamkannya.`}
                </span>
                {err("shop_id") && (
                  <span className="mt-1 block text-xs text-red-600">{err("shop_id")}</span>
                )}
              </label>

              <label className="mt-3 block">
                <span className="text-xs font-medium text-slate-600">Tipe Campaign</span>
                <select
                  name="campaign_type"
                  value={campaignType}
                  onChange={(e) => setCampaignType(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— jangan ubah —</option>
                  {CAMPAIGN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {shop.campaign_types.length > 0
                    ? `Sekarang: ${shop.campaign_types.map((t) => CAMPAIGN_TYPE_LABEL[t] ?? t).join(", ")}. `
                    : "Belum ada tipe campaign di kartu shop ini. "}
                  Pilihan di sini diterapkan ke semua kartunya.
                </span>
                {err("campaign_type") && (
                  <span className="mt-1 block text-xs text-red-600">{err("campaign_type")}</span>
                )}
              </label>

              {/* Nominal hanya relevan untuk campaign berbayar — pertanyaannya tidak
                  dirender sama sekali di tipe lain, jadi nilainya tidak ikut terkirim. */}
              {needsBudget && (
                <fieldset className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <legend className="px-1 text-xs font-medium">
                    Wajib untuk {CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL}
                  </legend>
                  <p className="text-[11px] text-amber-800">
                    Nominal ini hanya mengisi kartu yang kolomnya <strong>masih kosong</strong> —
                    kartu yang sudah punya angka tidak ditimpa. Isi nominal{" "}
                    <strong>per kartu produk</strong>, bukan total campaign.
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Ads Budget (Rp)</span>
                      <input
                        name="ads_budget"
                        type="number"
                        min="0"
                        required={shop.ads_budget_missing > 0}
                        placeholder="50000000"
                        className={inputCls}
                      />
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {shop.ads_budget_missing > 0
                          ? `${shop.ads_budget_missing} kartu masih kosong.`
                          : "Semua kartu sudah terisi."}
                      </span>
                      {err("ads_budget") && (
                        <span className="mt-1 block text-xs text-red-600">{err("ads_budget")}</span>
                      )}
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Service Fee (Rp)</span>
                      <input
                        name="service_fee"
                        type="number"
                        min="0"
                        required={shop.service_fee_missing > 0}
                        placeholder="5000000"
                        className={inputCls}
                      />
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {shop.service_fee_missing > 0
                          ? `${shop.service_fee_missing} kartu masih kosong.`
                          : "Semua kartu sudah terisi."}
                      </span>
                      {err("service_fee") && (
                        <span className="mt-1 block text-xs text-red-600">{err("service_fee")}</span>
                      )}
                    </label>
                  </div>
                </fieldset>
              )}

              <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
                Hanya Shop ID &amp; Tipe Campaign yang bisa diseragamkan dari sini. Harga, komisi,
                dan masa berlaku berbeda per produk — perbaiki lewat tombol Edit di tab Produk TAP.
              </p>

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
                  {pending ? "Menyimpan…" : `Simpan ke ${shop.product_count} kartu`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

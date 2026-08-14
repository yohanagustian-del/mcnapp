"use client";

import { useState } from "react";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_NEEDS_BUDGET,
  CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL,
} from "@/lib/deals/campaign-type";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * Pertanyaan tambahan untuk "Upload Produk Deal Lama via Excel".
 *
 * File export TAP tidak membawa Tipe Campaign, Ads Budget, maupun Service Fee —
 * ketiganya dimensi komersial MEA, bukan data platform. Karena satu file upload =
 * satu deal, ketiganya cukup ditanyakan SEKALI di sini lalu diisikan server ke
 * setiap kartu di file itu.
 *
 * Tipe Campaign wajib (jawaban inilah yang mengisi kolom Tipe Campaign), dan Ads
 * Budget + Service Fee ikut wajib begitu Paid Campaign dipilih — aturan yang sama
 * dengan form Registrasi Deal satuan, divalidasi ulang server lewat
 * productCardIssues(), jadi `required` di sini hanya mempercepat umpan balik.
 */
export function UploadCampaignFields() {
  const [campaignType, setCampaignType] = useState("");
  const needsBudget = campaignType === CAMPAIGN_TYPE_NEEDS_BUDGET;

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Tipe Campaign *
          <select
            name="campaign_type"
            required
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
        </label>

        {/* Nominal hanya relevan untuk campaign berbayar — pertanyaannya tidak
            dirender sama sekali di tipe lain, jadi nilainya tidak ikut terkirim. */}
        {needsBudget && (
          <>
            <label className="block text-sm font-medium">
              Ads Budget (Rp) *
              <input
                name="ads_budget"
                type="number"
                min="0"
                required
                placeholder="50000000"
                className={inputCls}
              />
            </label>
            <label className="block text-sm font-medium">
              Service Fee (Rp) *
              <input
                name="service_fee"
                type="number"
                min="0"
                required
                placeholder="5000000"
                className={inputCls}
              />
            </label>
          </>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Jawaban ini mengisi kolom <strong>Tipe Campaign</strong> semua kartu di file.
        {needsBudget ? (
          <>
            {" "}
            {CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL} mewajibkan Ads Budget &amp; Service Fee; nominalnya
            diisikan ke <strong>setiap kartu</strong>, jadi isi angka{" "}
            <strong>per produk</strong>, bukan total campaign.
          </>
        ) : (
          " Tipe non-berbayar tidak punya nominal, jadi Ads Budget & Service Fee dikosongkan."
        )}{" "}
        Kalau satu file berisi beberapa tipe campaign, pisahkan filenya per tipe.
      </p>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { parseCommission } from "@/lib/utils/commission";
import { updateDeal, type DealFormState } from "../actions";

interface PicOption {
  id: string;
  name: string;
}

export interface EditableDeal {
  id: string;
  brand_name: string;
  shop_id: string | null;
  niche: string | null;
  exp_date: string | null;
  komisi_kreator_raw: string | null;
  komisi_kreator_pct: number | null;
  komisi_mea_raw: string | null;
  komisi_mea_pct: number | null;
  pic_tap: string | null;
  campaign_name: string | null;
  campaign_type: string | null;
  brand_link: string | null;
  gmv_tap: number | null;
  avg_price: number | null;
  ads_budget: number | null;
  service_fee: number | null;
  notes: string | null;
}

// 4 tipe campaign baru (pola sama dengan deals/baru/deal-form.tsx).
const NEW_CAMPAIGN_TYPES: { value: string; label: string }[] = [
  { value: "paid_endorsement", label: "Paid / Endorsement" },
  { value: "bulking_ads_endorse", label: "Bulking Ads & Endorse" },
  { value: "bulking_ads", label: "Bulking Ads" },
  { value: "cps", label: "CPS (Sample, Voucher, Ads) — bertahap" },
];
// Nilai lama yang masih mungkin tersimpan di baris lama (0024_campaign_types.sql) —
// hanya ditampilkan sebagai opsi tambahan bila nilai campaign_type saat ini masih salah satu dari ini,
// supaya baris lama tidak dipaksa ganti tipe saat diedit.
const LEGACY_CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  paid: "Paid (lama)",
  sample: "Sample (non-berbayar, lama)",
  extra_commission: "Komisi Extra (non-berbayar, lama)",
};

export function EditDealForm({ deal, picOptions }: { deal: EditableDeal; picOptions: PicOption[] }) {
  const [state, formAction, pending] = useActionState<DealFormState | null, FormData>(
    updateDeal,
    null
  );
  const err = (field: string) => state?.fieldErrors?.[field];

  const [kreatorMin, kreatorMax] = splitCommission(deal.komisi_kreator_raw, deal.komisi_kreator_pct);
  const [meaMin, meaMax] = splitCommission(deal.komisi_mea_raw, deal.komisi_mea_pct);
  const legacyType =
    deal.campaign_type && LEGACY_CAMPAIGN_TYPE_LABEL[deal.campaign_type] ? deal.campaign_type : null;

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <input type="hidden" name="id" value={deal.id} />

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
        <input name="brand_name" required defaultValue={deal.brand_name} className={inputCls} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Shop ID (angka)" error={err("shop_id")}>
          <input
            name="shop_id"
            required
            inputMode="numeric"
            pattern="\d+"
            defaultValue={deal.shop_id ?? ""}
            className={inputCls}
          />
        </Field>
        <Field label="Niche" error={err("niche")}>
          <input name="niche" required defaultValue={deal.niche ?? ""} className={inputCls} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Exp Date (durasi deal → deal_end)" error={err("exp_date")}>
          <input name="exp_date" type="date" required defaultValue={deal.exp_date ?? ""} className={inputCls} />
        </Field>
        <Field label="PIC Campaign" error={err("pic_tap")}>
          <select name="pic_tap" required defaultValue={deal.pic_tap ?? ""} className={inputCls}>
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
            <input
              name="komisi_kreator_min"
              type="number"
              step="0.1"
              min="0"
              max="100"
              required
              defaultValue={kreatorMin ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Max (kosongkan bila bukan range)" error={err("komisi_kreator_max")}>
            <input
              name="komisi_kreator_max"
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue={kreatorMax ?? ""}
              className={inputCls}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium">Komisi MEA (%)</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min" error={err("komisi_mea_min")}>
            <input
              name="komisi_mea_min"
              type="number"
              step="0.1"
              min="0"
              max="100"
              required
              defaultValue={meaMin ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Max (kosongkan bila bukan range)" error={err("komisi_mea_max")}>
            <input
              name="komisi_mea_max"
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue={meaMax ?? ""}
              className={inputCls}
            />
          </Field>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Campaign Name" error={err("campaign_name")}>
          <input name="campaign_name" required defaultValue={deal.campaign_name ?? ""} className={inputCls} />
        </Field>
        <Field label="Tipe Campaign" error={err("campaign_type")}>
          <select name="campaign_type" defaultValue={deal.campaign_type ?? "paid_endorsement"} className={inputCls}>
            {NEW_CAMPAIGN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
            {legacyType && (
              <option value={legacyType}>{LEGACY_CAMPAIGN_TYPE_LABEL[legacyType]}</option>
            )}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Ads Budget (Rp, angka murni — opsional)" error={err("ads_budget")}>
          <input name="ads_budget" type="number" min="0" defaultValue={deal.ads_budget ?? ""} className={inputCls} />
        </Field>
        <Field label="Service Fee (Rp, angka murni — opsional)" error={err("service_fee")}>
          <input name="service_fee" type="number" min="0" defaultValue={deal.service_fee ?? ""} className={inputCls} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="GMV TAP (Rp, angka murni — opsional)" error={err("gmv_tap")}>
          <input name="gmv_tap" type="number" min="0" defaultValue={deal.gmv_tap ?? ""} className={inputCls} />
        </Field>
        <Field label="Avg Harga (Rp, angka murni — opsional)" error={err("avg_price")}>
          <input name="avg_price" type="number" min="0" defaultValue={deal.avg_price ?? ""} className={inputCls} />
        </Field>
      </div>

      <Field label="Link Brand (opsional)" error={err("brand_link")}>
        <input name="brand_link" type="url" defaultValue={deal.brand_link ?? ""} className={inputCls} placeholder="https://..." />
      </Field>

      <Field label="Catatan (opsional)">
        <textarea name="notes" rows={3} defaultValue={deal.notes ?? ""} className={inputCls} />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menyimpan..." : "Simpan Perubahan"}
      </button>
    </form>
  );
}

/** Prefill min/max dari komisi_*_raw ("5-7%" / "10%"); fallback ke pct tersimpan bila raw tidak terbaca. */
function splitCommission(raw: string | null, pct: number | null): [number | null, number | null] {
  const parsed = parseCommission(raw);
  if (parsed) return [parsed.min, parsed.isRange ? parsed.max : null];
  return [pct, null];
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

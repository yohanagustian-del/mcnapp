"use client";

import { useActionState } from "react";
import {
  BRAND_LEAD_PLATFORMS,
  BRAND_LEAD_SOURCES,
  BRAND_LEAD_STATUSES,
  BRAND_LEAD_SUPPORT,
} from "@/lib/leads/brand-lead";
import type { LeadFormState } from "./actions";

const SOURCE_LABELS: Record<string, string> = {
  matchmaking: "Matchmaking",
  event: "Event",
  iklan: "Iklan",
  rekomendasi: "Rekomendasi",
  scouting: "Scouting",
  others: "Lainnya",
};
const PLATFORM_LABELS: Record<string, string> = { shopee: "Shopee", tiktok_shop: "TikTok Shop" };
const SUPPORT_LABELS: Record<string, string> = {
  tap: "TAP",
  ads_support: "Ads Support",
  hsl: "HSL",
  sample: "Sample",
  rate_card: "Rate Card",
};
const STATUS_LABELS: Record<string, string> = {
  baru: "Baru",
  kontak: "Kontak",
  nego: "Nego",
  deal: "Deal",
  batal: "Batal",
};

export interface LeadContactDefault {
  lead_name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface LeadFormDefaults {
  source?: string;
  source_other?: string | null;
  shop_name?: string | null;
  city?: string | null;
  business_category?: string | null;
  store_link?: string | null;
  platforms?: string[];
  marketing_budget?: number | null;
  target_roas?: number | null;
  brand_support?: string[];
  status?: string;
  notes?: string | null;
  contacts?: LeadContactDefault[];
}

const CONTACT_ROWS = 5;

export function LeadForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: LeadFormState | null, formData: FormData) => Promise<LeadFormState>;
  defaults?: LeadFormDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<LeadFormState | null, FormData>(action, null);
  const contacts = defaults?.contacts ?? [];

  const field = (name: string) => state?.fieldErrors?.[name];

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-slate-500">Asal Lead *</label>
          <select name="source" defaultValue={defaults?.source ?? ""} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">— Pilih —</option>
            {BRAND_LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
          {field("source") && <p className="mt-1 text-xs text-red-600">{field("source")}</p>}
        </div>
        <div>
          <label className="block text-xs text-slate-500">Asal Lain (bila "Lainnya")</label>
          <input name="source_other" defaultValue={defaults?.source_other ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Nama Toko/Brand</label>
          <input name="shop_name" defaultValue={defaults?.shop_name ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Kota</label>
          <input name="city" defaultValue={defaults?.city ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Kategori Bisnis</label>
          <input name="business_category" defaultValue={defaults?.business_category ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Link Toko</label>
          <input name="store_link" defaultValue={defaults?.store_link ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Budget Marketing (Rp)</label>
          <input name="marketing_budget" defaultValue={defaults?.marketing_budget ?? ""} placeholder="Rp5.000.000" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Target ROAS</label>
          <input name="target_roas" type="number" min={0} step={0.1} defaultValue={defaults?.target_roas ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Status</label>
          <select name="status" defaultValue={defaults?.status ?? "baru"} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            {BRAND_LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-500">Platform</p>
        <div className="mt-1 flex gap-4">
          {BRAND_LEAD_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="platforms" value={p} defaultChecked={defaults?.platforms?.includes(p)} />
              {PLATFORM_LABELS[p]}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-500">Dukungan Brand yang Ditawarkan</p>
        <div className="mt-1 flex flex-wrap gap-4">
          {BRAND_LEAD_SUPPORT.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="brand_support" value={s} defaultChecked={defaults?.brand_support?.includes(s)} />
              {SUPPORT_LABELS[s]}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-500">Catatan</label>
        <textarea name="notes" defaultValue={defaults?.notes ?? ""} rows={2} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700">Data Prospek (kontak PIC)</p>
        <p className="text-xs text-slate-500">Isi minimal satu kontak ATAU Nama Toko di atas.</p>
        <div className="mt-2 space-y-2">
          {Array.from({ length: CONTACT_ROWS }, (_, i) => contacts[i] ?? {}).map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <input name={`contact_name_${i}`} defaultValue={c.lead_name ?? ""} placeholder="Nama PIC" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input name={`contact_phone_${i}`} defaultValue={c.phone ?? ""} placeholder="No. HP" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input name={`contact_email_${i}`} defaultValue={c.email ?? ""} placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          ))}
        </div>
        {field("shop_name") && <p className="mt-1 text-xs text-red-600">{field("shop_name")}</p>}
      </div>

      {state && (
        <p className={`rounded-md p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "Menyimpan..." : submitLabel}
      </button>
    </form>
  );
}

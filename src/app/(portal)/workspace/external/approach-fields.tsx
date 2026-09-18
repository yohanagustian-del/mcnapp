"use client";

import { NICHE_OPTIONS, PLATFORM_OPTIONS, CHANNEL_OPTIONS } from "@/lib/workspace/external-approach";

export const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

export function Field({
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

export interface ApproachDefaults {
  username?: string;
  brand?: string;
  creator_id?: string;
  niche?: string;
  platform?: string;
  followers?: number | string;
  wa_number?: string;
  gmv?: number | string;
  channel?: string;
  scouting_date?: string;
  reachout_date?: string;
  respon_date?: string;
  follow_up_1_date?: string;
  follow_up_2_date?: string;
  follow_up_3_date?: string;
  using_tap_date?: string;
  prove_link?: string;
  notes?: string;
}

/** Semua field form pipeline scouting external creator — dipakai form tambah & form edit. */
export function ApproachFields({
  defaults = {},
  err,
}: {
  defaults?: ApproachDefaults;
  err: (field: string) => string | undefined;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Username *" error={err("username")}>
          <input name="username" required defaultValue={defaults.username} className={inputCls} placeholder="@namacreator" />
        </Field>
        <Field label="Brand *" error={err("brand")}>
          <input name="brand" required defaultValue={defaults.brand} className={inputCls} placeholder="Nama brand" />
        </Field>
        <Field label="Creator ID (bila terdaftar)" error={err("creator_id")}>
          <input name="creator_id" defaultValue={defaults.creator_id} className={inputCls} placeholder="CRT-..." />
        </Field>

        <Field label="Niche" error={err("niche")}>
          <select name="niche" defaultValue={defaults.niche ?? ""} className={inputCls}>
            <option value="">Pilih niche…</option>
            {NICHE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Platform" error={err("platform")}>
          <select name="platform" defaultValue={defaults.platform ?? ""} className={inputCls}>
            <option value="">Pilih platform…</option>
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Channel" error={err("channel")}>
          <select name="channel" defaultValue={defaults.channel ?? ""} className={inputCls}>
            <option value="">Pilih channel…</option>
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Followers" error={err("followers")}>
          <input name="followers" type="number" min="0" step="1" defaultValue={defaults.followers} className={inputCls} placeholder="10000" />
        </Field>
        <Field label="Kontak WA" error={err("wa_number")}>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-500">+62</span>
            <input
              name="wa_number"
              inputMode="numeric"
              defaultValue={defaults.wa_number}
              className={`${inputCls} mt-0`}
              placeholder="812xxxxxxxx"
            />
          </div>
        </Field>
        <Field label="GMV (Rp)" error={err("gmv")}>
          <input name="gmv" type="number" min="0" step="1" defaultValue={defaults.gmv} className={inputCls} placeholder="1000000" />
        </Field>

        <Field label="Scouting" error={err("scouting_date")}>
          <input name="scouting_date" type="date" defaultValue={defaults.scouting_date} className={inputCls} />
        </Field>
        <Field label="Reachout" error={err("reachout_date")}>
          <input name="reachout_date" type="date" defaultValue={defaults.reachout_date} className={inputCls} />
        </Field>
        <Field label="Respon" error={err("respon_date")}>
          <input name="respon_date" type="date" defaultValue={defaults.respon_date} className={inputCls} />
        </Field>

        <Field label="Follow Up 1" error={err("follow_up_1_date")}>
          <input name="follow_up_1_date" type="date" defaultValue={defaults.follow_up_1_date} className={inputCls} />
        </Field>
        <Field label="Follow Up 2" error={err("follow_up_2_date")}>
          <input name="follow_up_2_date" type="date" defaultValue={defaults.follow_up_2_date} className={inputCls} />
        </Field>
        <Field label="Follow Up 3" error={err("follow_up_3_date")}>
          <input name="follow_up_3_date" type="date" defaultValue={defaults.follow_up_3_date} className={inputCls} />
        </Field>

        <Field label="Using TAP" error={err("using_tap_date")}>
          <input name="using_tap_date" type="date" defaultValue={defaults.using_tap_date} className={inputCls} />
        </Field>
        <Field label="Prove (link)" error={err("prove_link")}>
          <input name="prove_link" type="url" defaultValue={defaults.prove_link} className={inputCls} placeholder="https://..." />
        </Field>
      </div>

      <Field label="Notes" error={err("notes")}>
        <textarea name="notes" rows={3} defaultValue={defaults.notes} className={inputCls} placeholder="Catatan…" />
      </Field>
    </>
  );
}

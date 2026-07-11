"use client";

import { useActionState, useState } from "react";
import { updateCreator, type CreatorEditState } from "./actions";

/** Nilai awal untuk prefill form (hanya field yang boleh diedit). */
export interface CreatorEditValues {
  id: string;
  name: string | null;
  username: string | null;
  phone: string | null;
  profile_link: string | null;
  uid: string | null;
  followers: string | null;
  content_quality: string | null;
  join_date: string | null;
  domisili: string | null;
  jenis_creator: string | null;
  niche: string | null;
  level: number | null;
  platform: string | null;
  status: string | null;
  contract_end_date: string | null;
  target_gmv_monthly: number | null;
}

const STATUS_OPTIONS = ["prospek", "binding", "aktif", "nonaktif"] as const;
const PLATFORM_OPTIONS = ["tiktok", "shopee"] as const;

export function EditCreatorForm({ creator }: { creator: CreatorEditValues }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CreatorEditState | null, FormData>(
    updateCreator,
    null
  );

  const err = (field: string) => state?.fieldErrors?.[field];
  const v = (x: string | number | null) => (x === null || x === undefined ? "" : String(x));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Edit Data Creator
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Edit Data Creator</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Tutup
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        GMV total / live / video dan sharing komisi tidak bisa diedit di sini — auto-computed dari
        upload data platform mingguan (read-only).
      </p>

      <input type="hidden" name="creator_id" value={creator.id} />

      {state && (
        <p
          className={`mt-4 rounded-md p-3 text-sm ${
            state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nama Creator" error={err("name")}>
          <input name="name" required defaultValue={v(creator.name)} className={inputCls} />
        </Field>
        <Field label="Username" error={err("username")}>
          <input name="username" defaultValue={v(creator.username)} className={inputCls} />
        </Field>
        <Field label="No HP" error={err("phone")}>
          <input name="phone" defaultValue={v(creator.phone)} className={inputCls} />
        </Field>
        <Field label="Link Profile" error={err("profile_link")}>
          <input name="profile_link" defaultValue={v(creator.profile_link)} className={inputCls} />
        </Field>
        <Field label="UID" error={err("uid")}>
          <input name="uid" defaultValue={v(creator.uid)} className={inputCls} />
        </Field>
        <Field label="Followers (range teks)" error={err("followers")}>
          <input name="followers" defaultValue={v(creator.followers)} className={inputCls} />
        </Field>
        <Field label="Kualitas Konten" error={err("content_quality")}>
          <input name="content_quality" defaultValue={v(creator.content_quality)} className={inputCls} />
        </Field>
        <Field label="Jenis Creator" error={err("jenis_creator")}>
          <input name="jenis_creator" defaultValue={v(creator.jenis_creator)} className={inputCls} placeholder="live & vt / vt / live" />
        </Field>
        <Field label="Niche" error={err("niche")}>
          <input name="niche" defaultValue={v(creator.niche)} className={inputCls} />
        </Field>
        <Field label="Domisili" error={err("domisili")}>
          <input name="domisili" defaultValue={v(creator.domisili)} className={inputCls} />
        </Field>
        <Field label="Level (1-6, kosongkan bila belum ada)" error={err("level")}>
          <input name="level" type="number" min="1" max="6" step="1" defaultValue={v(creator.level)} className={inputCls} />
        </Field>
        <Field label="Platform" error={err("platform")}>
          <select name="platform" defaultValue={v(creator.platform)} className={inputCls}>
            <option value="">—</option>
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Status" error={err("status")}>
          <select name="status" defaultValue={v(creator.status) || "prospek"} className={inputCls}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Join Date" error={err("join_date")}>
          <input name="join_date" type="date" defaultValue={v(creator.join_date)} className={inputCls} />
        </Field>
        <Field label="Contract End Date" error={err("contract_end_date")}>
          <input name="contract_end_date" type="date" defaultValue={v(creator.contract_end_date)} className={inputCls} />
        </Field>
        <Field label="Target GMV Bulanan (Rp, angka murni)" error={err("target_gmv_monthly")}>
          <input name="target_gmv_monthly" type="number" min="0" defaultValue={v(creator.target_gmv_monthly)} className={inputCls} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-5 rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menyimpan..." : "Simpan Perubahan"}
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

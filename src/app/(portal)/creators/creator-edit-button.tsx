"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { CREATOR_CLASS_OPTIONS, DEFAULT_CREATOR_CLASS } from "@/lib/creators/creator-class";
import { updateCreatorProfile, type CreatorEditState } from "./actions";

/**
 * Field editable oleh Creator Manager = seluruh kolom master yang diisi manusia.
 *
 * TIDAK termasuk (sengaja): `commission_share` (read-only, sync platform —
 * CLAUDE.md #3), `gmv`/`gmv_live`/`gmv_video` (dihitung dari upload data platform
 * mingguan di /ingest), dan "Sisa Kontrak" (computed dari join_date + End Date).
 */
export interface EditableCreator {
  id: string;
  name: string;
  username: string | null;
  profile_link: string | null;
  phone: string | null;
  uid: string | null;
  platform: string | null;
  jenis_creator: string | null;
  creator_class: string | null;
  niche: string | null;
  top_niches: string[] | null;
  followers: string | null;
  content_quality: string | null;
  level: number | null;
  rc_live: string | null;
  rc_video: string | null;
  rate_card: number | null;
  join_date: string | null;
  contract_end_date: string | null;
  domisili: string | null;
  alamat: string | null;
  status: string;
  owner_cpm_id: string | null;
}

/** Pilihan CM untuk dropdown "CM" (hanya tampil bila punya izin m8.assign_creator). */
export interface EditCmOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = ["prospek", "binding", "aktif", "nonaktif"] as const;
const PLATFORM_OPTIONS = [
  { value: "tiktok", label: "Tiktok" },
  { value: "shopee", label: "Shopee" },
] as const;

const labelCls = "block text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

/** Satu input berlabel — id-nya di-suffix creatorId supaya unik walau modal per baris. */
function Field({
  creatorId,
  name,
  title,
  defaultValue,
  type = "text",
  placeholder,
  required = false,
  inputMode,
  min,
  max,
  className,
}: {
  creatorId: string;
  name: string;
  title: string;
  defaultValue: string | number | null;
  type?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: "numeric";
  min?: number;
  max?: number;
  className?: string;
}) {
  const id = `${name}-${creatorId}`;
  return (
    <div className={className}>
      <label className={labelCls} htmlFor={id}>
        {title}
        {required && <span className="text-red-600"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        inputMode={inputMode}
        min={min}
        max={max}
        autoComplete="off"
        defaultValue={defaultValue ?? ""}
        className={inputCls}
      />
    </div>
  );
}

/** Satu <select> berlabel. */
function SelectField({
  creatorId,
  name,
  title,
  defaultValue,
  children,
}: {
  creatorId: string;
  name: string;
  title: string;
  defaultValue: string;
  children: ReactNode;
}) {
  const id = `${name}-${creatorId}`;
  return (
    <div>
      <label className={labelCls} htmlFor={id}>
        {title}
      </label>
      <select id={id} name={name} defaultValue={defaultValue} className={inputCls}>
        {children}
      </select>
    </div>
  );
}

/** Judul kelompok field — modal punya 20+ input, tanpa ini jadi tembok input. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="col-span-full mt-2 border-b border-slate-100 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 first:mt-0">
      {children}
    </h3>
  );
}

/**
 * Tombol Edit + modal untuk mengubah master data kreator satu baris.
 * Submit lewat server action updateCreatorProfile (audit_logs dicatat di server).
 */
export function CreatorEditButton({
  creator,
  cms,
  canAssignCm,
}: {
  creator: EditableCreator;
  /** Daftar CM aktif — hanya dipakai kalau canAssignCm. */
  cms: EditCmOption[];
  /** Izin m8.assign_creator: boleh memindah kreator antar CM. */
  canAssignCm: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CreatorEditState | null, FormData>(
    updateCreatorProfile,
    null
  );

  // Tutup modal otomatis setelah simpan sukses.
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  // Tutup dengan Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Niche disimpan sebagai array (top 3) — ditampilkan sebagai satu kolom teks
  // dipisah koma, lalu diparse kembali di server oleh util import yang sama.
  const nicheValue = (creator.top_niches ?? (creator.niche ? [creator.niche] : [])).join(", ");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-8 w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Edit Kreator</h2>
                <p className="text-xs text-slate-500">
                  {creator.name}
                  <span className="ml-1 font-mono text-[10px] text-slate-400">{creator.id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            <form action={action} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <input type="hidden" name="creator_id" value={creator.id} />

              <SectionTitle>Identitas &amp; kontak</SectionTitle>
              <Field
                creatorId={creator.id}
                name="username"
                title="Username"
                placeholder="winris12 (tanpa @)"
                defaultValue={creator.username}
              />
              <Field
                creatorId={creator.id}
                name="name"
                title="Nama Creator"
                required
                defaultValue={creator.name}
              />
              <Field
                creatorId={creator.id}
                name="phone"
                title="No HP"
                placeholder="628123456789"
                defaultValue={creator.phone}
              />
              <Field
                creatorId={creator.id}
                name="profile_link"
                title="Link Akun"
                type="url"
                placeholder="https://tiktok.com/@…"
                defaultValue={creator.profile_link}
                className="col-span-2"
              />
              <Field creatorId={creator.id} name="uid" title="UID" defaultValue={creator.uid} />

              <SectionTitle>Klasifikasi</SectionTitle>
              <SelectField
                creatorId={creator.id}
                name="platform"
                title="Platform"
                defaultValue={creator.platform ?? ""}
              >
                <option value="">—</option>
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </SelectField>
              <Field
                creatorId={creator.id}
                name="jenis_creator"
                title="Jenis / Kategory"
                placeholder="live & vt / vt / live"
                defaultValue={creator.jenis_creator}
              />
              <SelectField
                creatorId={creator.id}
                name="creator_class"
                title="Kelas Kreator"
                defaultValue={
                  CREATOR_CLASS_OPTIONS.some((o) => o.value === creator.creator_class)
                    ? (creator.creator_class as string)
                    : DEFAULT_CREATOR_CLASS
                }
              >
                {CREATOR_CLASS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
              <Field
                creatorId={creator.id}
                name="top_niches"
                title="Niche (Top 3)"
                placeholder="beauty, skincare, fashion"
                defaultValue={nicheValue}
                className="col-span-2"
              />
              <Field
                creatorId={creator.id}
                name="followers"
                title="Followers"
                placeholder="595000 / 120K"
                defaultValue={creator.followers}
              />
              <Field
                creatorId={creator.id}
                name="content_quality"
                title="Kualitas Konten"
                placeholder="Bagus / Cukup / Kurang"
                defaultValue={creator.content_quality}
              />
              <Field
                creatorId={creator.id}
                name="level"
                title="Level (1–8)"
                type="number"
                min={1}
                max={8}
                defaultValue={creator.level}
              />

              <SectionTitle>Rate card</SectionTitle>
              <Field
                creatorId={creator.id}
                name="rc_live"
                title="RC Live"
                defaultValue={creator.rc_live}
              />
              <Field
                creatorId={creator.id}
                name="rc_video"
                title="RC Video"
                defaultValue={creator.rc_video}
              />
              <Field
                creatorId={creator.id}
                name="rate_card"
                title="Rate Card (Rp)"
                inputMode="numeric"
                placeholder="mis. 1.500.000"
                defaultValue={creator.rate_card}
              />

              <SectionTitle>Kontrak &amp; status</SectionTitle>
              <Field
                creatorId={creator.id}
                name="join_date"
                title="Join Date"
                type="date"
                defaultValue={creator.join_date}
              />
              <Field
                creatorId={creator.id}
                name="contract_end_date"
                title="End Date (akhir kontrak)"
                type="date"
                defaultValue={creator.contract_end_date}
              />
              <SelectField
                creatorId={creator.id}
                name="status"
                title="Status"
                defaultValue={creator.status}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SelectField>
              {canAssignCm && (
                <SelectField
                  creatorId={creator.id}
                  name="owner_cpm_id"
                  title="CM"
                  defaultValue={creator.owner_cpm_id ?? ""}
                >
                  <option value="">— belum ada CM —</option>
                  {cms.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </SelectField>
              )}

              <SectionTitle>Lokasi</SectionTitle>
              <Field
                creatorId={creator.id}
                name="domisili"
                title="Domisili"
                placeholder="Surabaya"
                defaultValue={creator.domisili}
              />
              <Field
                creatorId={creator.id}
                name="alamat"
                title="Alamat Lengkap"
                placeholder="Jalan, kelurahan, kota"
                defaultValue={creator.alamat}
                className="col-span-2"
              />

              <p className="col-span-full rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                Sharing Komisi tidak bisa diedit di sini — sinkron dari platform (read-only). Turun =
                alert, bukan edit. GMV total / live / video juga read-only: dihitung dari upload data
                platform mingguan di <span className="font-medium">/ingest</span>. Sisa kontrak
                dihitung otomatis dari Join Date + End Date.
              </p>

              {state && !state.ok && (
                <p className="col-span-full text-xs text-red-600">{state.error}</p>
              )}

              <div className="col-span-full mt-1 flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
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

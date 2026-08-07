"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { CREATOR_CLASS_HINT, CREATOR_CLASS_OPTIONS } from "@/lib/creators/creator-class";
import { createCreatorManual, type CreateCreatorResult } from "./create-actions";

export interface CmOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = ["aktif", "prospek", "binding", "nonaktif"] as const;

const field = "rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";
const label = "block text-xs font-medium text-slate-600";

/** Satu input berlabel — dipakai untuk seluruh kolom opsional. */
function Field({
  name,
  title,
  placeholder,
  type = "text",
  required = false,
}: {
  name: string;
  title: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className={label}>
        {title}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        className={`${field} mt-1 w-full`}
      />
    </label>
  );
}

/**
 * Tombol + modal "Tambah Kreator" (input manual satu kreator).
 *
 * Username & CM wajib; sisanya opsional dan boleh dikosongkan. Kalau username
 * sudah terdaftar, form TIDAK langsung menimpa: server mengembalikan data
 * kreator lama, modal menampilkannya sebagai perbandingan, lalu user memilih
 * sendiri mau menimpa, membuka kreator itu, atau mengganti username.
 */
export function CreatorCreateDialog({ cms }: { cms: CmOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CreateCreatorResult, FormData>(
    createCreatorManual,
    { status: "idle" }
  );
  const formRef = useRef<HTMLFormElement>(null);
  /** Diisi saat user menekan "Timpa data lama" — dikirim ulang sebagai overwrite=1. */
  const overwriteRef = useRef<HTMLInputElement>(null);

  const done = state.status === "created" || state.status === "updated";

  // Sukses → kosongkan form supaya bisa langsung input kreator berikutnya, dan
  // pastikan submit berikutnya tidak diam-diam masih membawa overwrite=1.
  useEffect(() => {
    if (!done) return;
    formRef.current?.reset();
    if (overwriteRef.current) overwriteRef.current.value = "";
  }, [done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        + Tambah Kreator
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white opacity-60"
      >
        + Tambah Kreator
      </button>

      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
        onClick={() => !pending && setOpen(false)}
      >
        <div
          className="my-8 w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tambah-kreator-title"
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 id="tambah-kreator-title" className="text-lg font-semibold text-slate-900">
                Tambah Kreator
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Username &amp; CM wajib diisi — sisanya opsional dan bisa dilengkapi belakangan
                lewat tombol Edit. Sharing komisi tidak bisa diisi manual (read-only, sync
                platform).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              aria-label="Tutup"
              className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            >
              ✕
            </button>
          </div>

          {/* --- Username bentrok: tampilkan pembanding + pilihan tindakan --- */}
          {state.status === "duplicate" && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">⚠ {state.message}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-amber-900 sm:grid-cols-3">
                <div><dt className="text-amber-700">Nama</dt><dd className="font-medium">{state.existing.name}</dd></div>
                <div><dt className="text-amber-700">CM saat ini</dt><dd className="font-medium">{state.existing.cmName ?? "—"}</dd></div>
                <div><dt className="text-amber-700">Status</dt><dd className="font-medium">{state.existing.status}</dd></div>
                <div><dt className="text-amber-700">Platform</dt><dd className="font-medium">{state.existing.platform ?? "—"}</dd></div>
                <div><dt className="text-amber-700">Join</dt><dd className="font-medium">{state.existing.joinDate ?? "—"}</dd></div>
                <div><dt className="text-amber-700">ID</dt><dd className="font-mono">{state.existing.id}</dd></div>
              </dl>

              <p className="mt-3 text-xs text-amber-900">
                <strong>Rekomendasi:</strong> username = identitas akun di platform, jadi dua
                kreator tidak boleh memakainya bersamaan.
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-amber-900">
                <li>
                  <strong>Orang yang sama</strong> (data lama belum lengkap) → pakai{" "}
                  <em>Timpa data lama</em>. Kolom yang Anda kosongkan tidak akan menghapus data
                  lama.
                </li>
                <li>
                  <strong>Kreator lama ganti username</strong> → jangan timpa. Buka kreator itu,
                  ubah username-nya dulu, baru tambahkan yang baru.
                </li>
                <li>
                  <strong>Kreator lama sudah tidak aktif</strong> → set statusnya{" "}
                  <em>nonaktif</em> (jangan dihapus, riwayat GMV-nya ikut hilang), lalu daftarkan
                  yang baru.
                </li>
              </ul>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (overwriteRef.current) overwriteRef.current.value = "1";
                    formRef.current?.requestSubmit();
                  }}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {pending ? "Menyimpan…" : "Timpa data lama"}
                </button>
                <Link
                  href={`/creators/${state.existing.id}`}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
                >
                  Buka kreator ini
                </Link>
                <span className="text-xs text-amber-800">
                  atau ubah username di form lalu Simpan lagi.
                </span>
              </div>
            </div>
          )}

          {done && (
            <p role="status" className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              ✓ {state.message}{" "}
              {"creatorId" in state && (
                <Link href={`/creators/${state.creatorId}`} className="underline">
                  buka kreator
                </Link>
              )}
            </p>
          )}

          {state.status === "error" && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {state.message}</p>
          )}

          <form ref={formRef} action={formAction} className="mt-4">
            <input ref={overwriteRef} type="hidden" name="overwrite" defaultValue="" />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field name="username" title="Username" placeholder="winris12 (tanpa @)" required />
              <label className="block">
                <span className={label}>
                  CM<span className="text-red-600"> *</span>
                </span>
                <select name="owner_cpm_id" required defaultValue="" className={`${field} mt-1 w-full`}>
                  <option value="">— pilih CM —</option>
                  {cms.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <Field name="nama_creator" title="Nama Creator" placeholder="Kosong → pakai username" />

              <Field name="no_hp" title="No HP" placeholder="628123456789" />
              <label className="block">
                <span className={label}>Platform</span>
                <select name="platform" defaultValue="tiktok" className={`${field} mt-1 w-full`}>
                  <option value="tiktok">Tiktok</option>
                  <option value="shopee">Shopee</option>
                </select>
              </label>
              <Field name="link_akun" title="Link Akun" placeholder="https://tiktok.com/@…" />

              <Field name="kategory" title="Kategory" placeholder="Video Creator / Live Creator" />
              <label className="block">
                <span className={label}>Kelas Kreator</span>
                <select name="kelas_kreator" defaultValue="" className={`${field} mt-1 w-full`}>
                  <option value="">— Reguler (default) —</option>
                  {CREATOR_CLASS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.label}>{o.label}</option>
                  ))}
                </select>
                {/* Arti tiap kelas ditulis di bawah dropdown — terutama "Eksternal"
                    yang baru, supaya tidak ditebak-tebak saat mendaftar kreator. */}
                <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                  {CREATOR_CLASS_HINT}
                </span>
              </label>
              <label className="block">
                <span className={label}>Status</span>
                <select name="status" defaultValue="aktif" className={`${field} mt-1 w-full`}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>

              <Field name="followers" title="Followers" placeholder="595000 / 120K" />
              <Field name="kualitas" title="Kualitas" placeholder="Bagus / Cukup / Kurang" />
              <Field name="level" title="Level" placeholder="1–8" />

              <Field name="domisili" title="Domisili" placeholder="Surabaya" />
              <Field name="uid" title="UID" placeholder="UID akun platform" />
              <Field name="alamat_lengkap" title="Alamat Lengkap" placeholder="Jalan, kelurahan, kota" />

              <Field name="rc_live" title="RC Live" />
              <Field name="rc_video" title="RC Video" />
              <Field name="rate_card" title="Rate Card" placeholder="Rp1.500.000" />

              <Field name="join_date" title="Join Date" type="date" />
              <Field name="end_date" title="End Date (akhir kontrak)" type="date" />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={pending}
                // Submit biasa selalu "jangan timpa" — penimpaan hanya lewat tombol
                // khusus di panel peringatan di atas.
                onClick={() => {
                  if (overwriteRef.current) overwriteRef.current.value = "";
                }}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {pending ? "Menyimpan…" : "Simpan Kreator"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

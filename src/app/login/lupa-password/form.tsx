"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

/**
 * Form permintaan tautan reset. Pesan sukses sengaja tidak menyebut apakah
 * email terdaftar — lihat komentar di requestPasswordReset.
 */
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordReset,
    null
  );

  if (state?.ok) {
    return (
      <div className="mt-6 space-y-4">
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Jika email tersebut terdaftar sebagai akun aktif, tautan reset password sudah
          dikirim. Cek inbox — termasuk folder spam. Tautan berlaku 1 jam.
        </p>
        <Link href="/login" className="block text-sm text-slate-600 underline hover:text-slate-900">
          ← Kembali ke halaman masuk
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          placeholder="nama@meagency.co.id"
        />
      </div>

      {state && !state.ok && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Mengirim…" : "Kirim Tautan Reset"}
      </button>

      <Link href="/login" className="block text-center text-sm text-slate-600 underline hover:text-slate-900">
        Kembali ke halaman masuk
      </Link>
    </form>
  );
}

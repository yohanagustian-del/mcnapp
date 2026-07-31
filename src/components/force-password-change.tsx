"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/account/actions";
import { logout } from "@/app/login/actions";

const labelCls = "block text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

/**
 * Layar pengunci untuk akun yang dibuat Director dengan password sementara
 * (team_members.must_change_password). Menggantikan seluruh isi portal sampai user
 * menyetel passwordnya sendiri — password sementara tidak boleh jadi password permanen
 * karena sempat melewati Director dan kanal chat.
 *
 * Memakai server action changePassword yang sama dengan ganti password biasa: password
 * sementara diisi sebagai "password saat ini", dan flag-nya di-reset di server saat sukses.
 */
export function ForcePasswordChange({ name }: { name: string }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    null
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Setel password Anda</h1>
        <p className="mt-1 text-sm text-slate-600">
          Halo {name}. Akun Anda dibuat dengan <strong>password sementara</strong>. Demi keamanan,
          ganti dulu dengan password pilihan Anda sendiri sebelum memakai portal.
        </p>

        <form action={action} className="mt-5 space-y-3">
          <div>
            <label className={labelCls} htmlFor="current_password">
              Password sementara (dari Director)
            </label>
            <input
              id="current_password"
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="new_password">
              Password baru (minimal 8 karakter)
            </label>
            <input
              id="new_password"
              name="new_password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="confirm_password">
              Ulangi password baru
            </label>
            <input
              id="confirm_password"
              name="confirm_password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputCls}
            />
          </div>

          {state && !state.ok && <p className="text-xs text-red-600">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Menyimpan…" : "Simpan & masuk portal"}
          </button>
        </form>

        <form action={logout} className="mt-4 text-center">
          <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-800">
            Keluar
          </button>
        </form>
      </div>
    </div>
  );
}

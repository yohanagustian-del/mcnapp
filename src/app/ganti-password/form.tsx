"use client";

import { useActionState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-reset";
import { setOwnPortalPassword, type ForcedPasswordState } from "./actions";

const labelCls = "block text-sm font-medium";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

export function ForcedPasswordForm() {
  const [state, action, pending] = useActionState<ForcedPasswordState, FormData>(setOwnPortalPassword, null);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className={labelCls} htmlFor="password">Password Baru</label>
        <input
          id="password" name="password" type="password" required
          minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" autoFocus
          className={inputCls}
        />
        <p className="mt-1 text-[11px] text-slate-400">Minimal {MIN_PASSWORD_LENGTH} karakter, berbeda dari password sementara.</p>
      </div>
      <div>
        <label className={labelCls} htmlFor="confirm_password">Konfirmasi Password Baru</label>
        <input
          id="confirm_password" name="confirm_password" type="password" required
          minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
          className={inputCls}
        />
      </div>
      {state && !state.ok && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "Menyimpan…" : "Simpan & Masuk Portal"}
      </button>
    </form>
  );
}

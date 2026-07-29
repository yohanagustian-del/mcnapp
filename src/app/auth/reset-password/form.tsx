"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-reset";
import { resetPassword, type ResetPasswordState } from "./actions";

const labelCls = "block text-sm font-medium";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

/** How long to wait for an implicit-flow fragment to be consumed before giving up. */
const SESSION_DETECT_TIMEOUT_MS = 3000;

type Phase = "checking" | "ready" | "invalid";

/**
 * Form password baru. /auth/confirm sudah menaruh sesi recovery di cookie untuk
 * tautan ber-`token_hash`/`code`; template email bawaan Supabase bisa juga
 * mengirim token di URL fragment (`#access_token=…`) yang tidak pernah sampai ke
 * server — createBrowserClient membacanya sendiri (detectSessionInUrl), jadi
 * komponen ini menunggu sesi muncul sebelum menampilkan form.
 */
export function ResetPasswordForm() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    resetPassword,
    null
  );

  useEffect(() => {
    const supabase = createClient();
    let settled = false;

    const markReady = () => {
      settled = true;
      setPhase("ready");
      // Drop the tokens from the address bar so they stay out of history/referrers.
      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) markReady();
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });

    const timer = setTimeout(() => {
      if (!settled) setPhase("invalid");
    }, SESSION_DETECT_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  if (phase === "checking") {
    return <p className="mt-6 text-sm text-slate-500">Memeriksa tautan…</p>;
  }

  if (phase === "invalid") {
    return (
      <div className="mt-6 space-y-4">
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Tautan reset tidak valid atau sudah kedaluwarsa.
        </p>
        <Link
          href="/login/lupa-password"
          className="block text-sm text-slate-600 underline hover:text-slate-900"
        >
          Minta tautan baru
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className={labelCls} htmlFor="new_password">
          Password Baru
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          autoFocus
          className={inputCls}
        />
        <p className="mt-1 text-[11px] text-slate-400">Minimal {MIN_PASSWORD_LENGTH} karakter.</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="confirm_password">
          Konfirmasi Password Baru
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className={inputCls}
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
        {pending ? "Menyimpan…" : "Simpan Password Baru"}
      </button>
    </form>
  );
}

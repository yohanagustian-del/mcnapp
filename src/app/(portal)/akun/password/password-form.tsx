"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "./actions";

const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState | null, FormData>(
    changePassword,
    null
  );

  return (
    // Remount on success so the input fields clear; the success message stays.
    <form action={formAction} key={state?.ok ? "done" : "form"} className="max-w-sm space-y-4">
      {state && (
        <p
          className={`rounded-md p-3 text-sm ${
            state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </p>
      )}

      <Field label="Password Lama">
        <input
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          className={inputCls}
        />
      </Field>

      <Field label="Password Baru (min. 8 karakter)">
        <input
          name="new_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputCls}
        />
      </Field>

      <Field label="Konfirmasi Password Baru">
        <input
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputCls}
        />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menyimpan…" : "Ubah Password"}
      </button>
    </form>
  );
}

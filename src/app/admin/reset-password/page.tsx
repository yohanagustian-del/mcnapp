"use client";

import { useActionState, useState } from "react";
import { resetUserPassword } from "./actions";

type ResetState = {
  ok: boolean;
  error?: string;
  message?: string;
} | null;

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    async (prevState, formData) => {
      const email = String(formData.get("email") ?? "").trim();
      const tempPassword = String(formData.get("temp_password") ?? "");
      return resetUserPassword(email, tempPassword);
    },
    null
  );

  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold">Reset Password User</h1>
        <p className="mt-1 text-sm text-slate-600">
          Admin only. Reset password untuk user terdaftar.
        </p>

        <form action={action} className="mt-8 space-y-4 rounded-lg bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email User
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="ilukman17@gmail.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="temp_password" className="block text-sm font-medium">
              Temporary Password
            </label>
            <div className="relative mt-1">
              <input
                id="temp_password"
                name="temp_password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                placeholder="Password123!"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-xs text-slate-600"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Minimal 8 karakter.</p>
          </div>

          {state && state.ok && (
            <div className="rounded-md bg-green-50 p-3">
              <p className="text-sm text-green-800">{state.message}</p>
              <p className="mt-2 rounded bg-green-100 p-2 font-mono text-xs text-green-900">
                {state.message?.split("ke: ")[1]}
              </p>
            </div>
          )}

          {state && !state.ok && (
            <div className="rounded-md bg-red-50 p-3">
              <p className="text-sm text-red-700">{state.error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Resetting…" : "Reset Password"}
          </button>
        </form>

        <div className="mt-6 rounded-lg bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-900">⚠️ Catatan Keamanan</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            <li>• Temporary password ini hanya untuk akses pertama kali</li>
            <li>• User harus ganti password setelah login pertama</li>
            <li>• Aksi ini tercatat di audit_logs</li>
            <li>• Hanya management yang bisa akses halaman ini</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

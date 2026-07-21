"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/account/actions";

const labelCls = "block text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

/**
 * Tombol "Ganti Password" + modal, dipasang di sidebar (internal & portal kreator),
 * di atas tombol Keluar. Submit lewat server action changePassword — verifikasi
 * password lama + audit_logs dicatat di server (tanpa pernah menyimpan password).
 */
export function ChangePasswordButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "text-xs text-slate-500 underline hover:text-slate-800"}
      >
        Ganti Password
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Ganti Password</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            <form action={action} className="mt-4 space-y-3">
              <div>
                <label className={labelCls} htmlFor="current_password">
                  Password Saat Ini
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
                  Password Baru
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
                <p className="mt-1 text-[11px] text-slate-400">Minimal 8 karakter.</p>
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
                  minLength={8}
                  autoComplete="new-password"
                  className={inputCls}
                />
              </div>

              {state && !state.ok && (
                <p className="text-xs text-red-600">{state.error}</p>
              )}

              <div className="mt-1 flex justify-end gap-2">
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

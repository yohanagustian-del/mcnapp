"use client";

import { useActionState, useEffect, useRef } from "react";
import type { AcquisitionActionResult } from "./actions";

/**
 * Form pembungkus untuk seluruh aksi di Acquisition Workspace.
 *
 * Kenapa ada: `<form action={serverAction}>` polos akan melempar isi error ke
 * error boundary Next.js, dan di production pesannya disensor jadi "Application
 * error: a server-side exception has occurred" — user kehilangan seluruh isian
 * tanpa tahu apa yang salah. Di sini hasil action dibaca lewat useActionState,
 * ditampilkan sebagai banner di atas form, dan tombol submit dikunci selama
 * proses berjalan (dobel-klik pada form registrasi bikin kiriman kedua gagal
 * dengan "username sudah terdaftar").
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Menyimpan…",
  className = "",
  buttonClassName,
  buttonTitle,
  /** Baris tabel: banner diganti teks kecil di bawah tombol supaya sel tidak melar. */
  compact = false,
  /** Kosongkan isian setelah sukses (form input baru; jangan untuk tombol baris). */
  resetOnSuccess = false,
}: {
  action: (prev: AcquisitionActionResult, formData: FormData) => Promise<AcquisitionActionResult>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  buttonClassName: string;
  buttonTitle?: string;
  compact?: boolean;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<AcquisitionActionResult, FormData>(action, {
    status: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);

  const ok = state.status === "ok";
  useEffect(() => {
    if (ok && resetOnSuccess) formRef.current?.reset();
  }, [ok, resetOnSuccess]);

  const message = state.status === "idle" ? null : (
    <p
      role={ok ? "status" : "alert"}
      className={
        compact
          ? `mt-1 max-w-[16rem] text-[11px] leading-tight ${ok ? "text-green-700" : "text-red-600"}`
          : `mb-3 rounded-md px-3 py-2 text-sm ${ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`
      }
    >
      {ok ? "✓ " : "⚠ "}
      {state.message}
    </p>
  );

  return (
    <div>
      {!compact && message}
      <form ref={formRef} action={formAction} className={className}>
        {children}
        <button
          type="submit"
          disabled={pending}
          title={buttonTitle}
          className={`${buttonClassName} disabled:opacity-50`}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
      {compact && message}
    </div>
  );
}

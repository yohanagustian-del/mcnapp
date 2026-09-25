"use client";

import { useRef, useState, useTransition } from "react";
import { ROLES } from "@/lib/rbac";
import { SEGMENTS, TEAM_GROUPS } from "@/lib/tim/roles";
import { addTeamMember, type AddMemberResult } from "./actions";

/**
 * Tambah satu akun anggota tim (di luar bulk upload). Hanya dirender untuk role
 * yang punya izin "team.add_single" (director/head/spv) — lihat page.tsx.
 */
export function AddMemberForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AddMemberResult | null>(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const res = await addTeamMember(formData);
      setResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <form ref={formRef} action={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input
          type="text" name="name" placeholder="Nama lengkap" required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="email" name="email" placeholder="Email" required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select name="role" required defaultValue="" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="" disabled>Role</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select name="team_group" defaultValue="" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">Grup (otomatis dari role)</option>
          {TEAM_GROUPS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select name="platform_segment" defaultValue="" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">Segmen (opsional)</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 sm:col-span-2 lg:col-span-1"
        >
          {pending ? "Memproses..." : "Tambah Akun"}
        </button>
      </form>

      {result && !result.ok && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-700">{result.message}</p>
        </div>
      )}

      {result && result.ok && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3" role="status">
          <p className="text-sm font-semibold text-green-800">✓ {result.message}</p>
          {result.tempPassword && (
            <p className="mt-2 text-xs text-amber-900">
              🔑 Password sementara (hanya ditampilkan sekali):{" "}
              <span className="font-mono font-semibold">{result.tempPassword}</span>
              {" — "}segera teruskan ke yang bersangkutan dan minta ganti setelah login pertama.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

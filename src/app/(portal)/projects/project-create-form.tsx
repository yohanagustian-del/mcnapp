"use client";

import { useActionState } from "react";
import { createProject, type ProjectFormState } from "./actions";

/**
 * Form buat Special Project — client component supaya validasi (nama kosong,
 * Target GMV tak kebaca) tampil inline di sebelah kolomnya lewat useActionState,
 * bukan jadi layar "Application error" generik (lihat catatan di actions.ts).
 */
export function ProjectCreateForm({
  projectTypes,
}: {
  projectTypes: readonly { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<ProjectFormState | null, FormData>(
    createProject,
    null
  );

  const err = (field: string) => state?.fieldErrors?.[field];

  return (
    <form
      action={formAction}
      className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {state && !state.ok && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 sm:col-span-2 lg:col-span-4">
          {state.message}
        </p>
      )}

      <Field error={err("name")}>
        <input name="name" placeholder="Nama project" className={inputCls} />
      </Field>
      <select name="type" required className={inputCls}>
        {projectTypes.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      <Field error={err("start_date")}>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Mulai
          <input type="date" name="start_date" required
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
        </label>
      </Field>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        Selesai
        <input type="date" name="end_date" required
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
      </label>
      <Field error={err("target_gmv")}>
        <input name="target_gmv" placeholder="Target GMV (Rp)" className={inputCls} />
      </Field>
      <Field error={err("target_creators")}>
        <input name="target_creators" type="number" min="1" placeholder="Target jumlah creator" className={inputCls} />
      </Field>
      <input name="ads_budget_cap" placeholder="Ads budget cap (Rp, opsional)" className={inputCls} />
      <select name="curve_shape" className={inputCls}>
        <option value="ramp">Kurva target: ramp-up (default)</option>
        <option value="flat">Kurva target: flat</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Menyimpan..." : "Buat Project"}
      </button>
    </form>
  );
}

const inputCls = "rounded-md border border-slate-300 px-3 py-2 text-sm";

function Field({ error, children }: { error?: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  );
}

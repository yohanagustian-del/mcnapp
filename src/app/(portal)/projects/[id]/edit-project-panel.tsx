"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteProject, updateProject, type ProjectFormState } from "../actions";

export interface EditableProject {
  id: number;
  name: string;
  type: string | null;
  startDate: string;
  endDate: string;
  targetGmv: number | null;
  adsBudgetCap: number | null;
  targetCreators: number | null;
  curveShape: "ramp" | "flat";
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

/**
 * Edit + Hapus project — tombol dobel di header detail project, hanya untuk
 * SPV/Head/Director (requireProjectLead di actions.ts menegakkannya lagi di
 * server, bukan cuma disembunyikan di sini). Dua modal terpisah supaya alur
 * "ubah" dan "hapus" tidak saling ganggu state-nya.
 */
export function EditProjectPanel({
  project, projectTypes,
}: {
  project: EditableProject;
  projectTypes: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [editState, editAction, editPending] = useActionState<ProjectFormState | null, FormData>(
    updateProject, null
  );
  const [deleteState, deleteAction, deletePending] = useActionState<ProjectFormState | null, FormData>(
    deleteProject, null
  );

  useEffect(() => {
    if (editState?.ok) setEditOpen(false);
  }, [editState]);

  useEffect(() => {
    if (deleteState?.ok) router.push("/projects");
  }, [deleteState, router]);

  const err = (field: string) => editState?.fieldErrors?.[field];

  return (
    <>
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Edit Project
      </button>
      <button
        type="button"
        onClick={() => setDeleteOpen(true)}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Hapus Project
      </button>

      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog" aria-modal="true" aria-label={`Edit project ${project.name}`}
        >
          <div className="my-16 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Edit project</h2>

            <form action={editAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="project_id" value={project.id} />
              {editState && !editState.ok && (
                <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">
                  {editState.message}
                </p>
              )}

              <Field error={err("name")}>
                <input name="name" defaultValue={project.name} placeholder="Nama project" className={inputCls} />
              </Field>
              <select name="type" defaultValue={project.type ?? "other"} required className={inputCls}>
                {projectTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <Field error={err("start_date")}>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Mulai
                  <input type="date" name="start_date" defaultValue={project.startDate} required
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
                </label>
              </Field>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Selesai
                <input type="date" name="end_date" defaultValue={project.endDate} required
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
              </label>
              <Field error={err("target_gmv")}>
                <input name="target_gmv" defaultValue={project.targetGmv ?? ""} placeholder="Target GMV (Rp)" className={inputCls} />
              </Field>
              <Field error={err("target_creators")}>
                <input name="target_creators" type="number" min="1" defaultValue={project.targetCreators ?? ""}
                  placeholder="Target jumlah creator" className={inputCls} />
              </Field>
              <input name="ads_budget_cap" defaultValue={project.adsBudgetCap ?? ""} placeholder="Ads budget cap (Rp, opsional)" className={inputCls} />
              <select name="curve_shape" defaultValue={project.curveShape} className={inputCls}>
                <option value="ramp">Kurva target: ramp-up</option>
                <option value="flat">Kurva target: flat</option>
              </select>

              <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
                <button type="button" onClick={() => setEditOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                  Batal
                </button>
                <button type="submit" disabled={editPending}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                  {editPending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog" aria-modal="true" aria-label={`Hapus project ${project.name}`}
        >
          <div className="my-16 w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Hapus project</h2>
            <p className="mt-2 text-sm text-slate-600">
              Project <strong>{project.name}</strong> dan seluruh data turunannya (peserta, metrik harian,
              live session, report kreator) akan dihapus permanen. Isi lengkapnya tetap tercatat di audit log.
            </p>

            <form action={deleteAction} className="mt-3">
              <input type="hidden" name="project_id" value={project.id} />
              <label className="block text-xs font-medium text-slate-700">
                Ketik nama project persis untuk konfirmasi
                <input
                  name="confirm" autoComplete="off" placeholder={project.name}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>

              {deleteState && !deleteState.ok && (
                <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
                  {deleteState.message}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setDeleteOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                  Batal
                </button>
                <button type="submit" disabled={deletePending}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                  {deletePending ? "Menghapus…" : "Hapus project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

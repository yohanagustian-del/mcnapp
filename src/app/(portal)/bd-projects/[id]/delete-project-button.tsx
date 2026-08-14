"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteBdProject, type ProjectFormState } from "../actions";

/**
 * Hapus Project BD.
 *
 * Yang hilang hanya pengelompokannya — kartu produk, deal, dan shop tidak
 * tersentuh. Yang ikut terhapus adalah report campaign yang menempel ke project
 * ini, dan itulah sebabnya konfirmasinya minta MENGETIK nama project, bukan
 * sekadar "OK": isinya memang tidak bisa dikembalikan dari layar mana pun (hanya
 * dari audit log).
 */
export function DeleteProjectButton({ project }: { project: { id: string; name: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ProjectFormState | null, FormData>(
    deleteBdProject,
    null
  );

  useEffect(() => {
    if (state?.ok) router.push("/bd-projects");
  }, [state, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50"
      >
        Hapus
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Hapus project ${project.name}`}
        >
          <div className="my-16 w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Hapus project</h2>
            <p className="mt-2 text-sm text-slate-600">
              Project <strong>{project.name}</strong> dan report campaign yang menempel padanya akan
              dihapus. Kartu produk, deal, dan shop <strong>tidak</strong> tersentuh. Isi lengkapnya
              tetap tercatat di audit log.
            </p>

            <form action={formAction} className="mt-3">
              <input type="hidden" name="project_id" value={project.id} />
              <label className="block text-xs font-medium text-slate-700">
                Ketik nama project persis untuk konfirmasi
                <input
                  name="confirm"
                  autoComplete="off"
                  placeholder={project.name}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>

              {state && !state.ok && (
                <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
                  {state.message}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {pending ? "Menghapus…" : "Hapus project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

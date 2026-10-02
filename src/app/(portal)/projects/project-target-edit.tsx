"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProjectTargetGmv } from "./actions";

/** Edit inline Target GMV project — dipakai leader (m7.edit_target); hanya mengubah target_gmv. */
export function ProjectTargetEdit({ projectId, initialTarget }: { projectId: number; initialTarget: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialTarget !== null ? String(Math.round(initialTarget)) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(initialTarget !== null ? String(Math.round(initialTarget)) : ""); setError(null); setEditing(true); }}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
      >
        Edit Target GMV
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const formData = new FormData();
        formData.set("project_id", String(projectId));
        formData.set("target_gmv", value);
        startTransition(async () => {
          const res = await updateProjectTargetGmv(formData);
          if (res.ok) { setEditing(false); router.refresh(); }
          else setError(res.error);
        });
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Target GMV (Rp)"
        className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
        autoFocus
      />
      <button type="submit" disabled={pending}
        className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "…" : "Simpan"}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={pending}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
        Batal
      </button>
      {error && <span className="ml-1 text-xs text-red-700">{error}</span>}
    </form>
  );
}

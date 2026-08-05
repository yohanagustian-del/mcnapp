"use client";

import { useState, useTransition } from "react";
import { addParticipant } from "../actions";

/** Kandidat peserta: username = yang diketik user, name = petunjuk di dropdown. */
export interface CreatorUsernameOption {
  id: string;
  username: string;
  name: string;
}

/**
 * Form tambah peserta project. Kreator dipilih lewat USERNAME (bukan `creators.id`) —
 * daftar username muncul otomatis lewat <datalist>, jadi tidak ada lagi ID internal
 * yang harus dihafal. Username yang tidak terdaftar ditolak server dan pesannya
 * ditampilkan di sini (server action mengembalikan error, tidak melempar — pesan yang
 * dilempar akan disensor Next.js di production).
 *
 * Siapa yang boleh membuka form ini ditentukan server (m7.manage ATAU man power
 * in-charge project ini) dan dicek ulang di server action — komponen ini tidak
 * memutuskan hak akses apa pun.
 */
export function ParticipantForm({
  projectId,
  creators,
  note,
}: {
  projectId: number;
  creators: CreatorUsernameOption[];
  /** Keterangan tambahan di bawah input (mis. alasan kenapa user ini boleh menambah). */
  note?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      const res = await addParticipant(formData);
      if (res.ok) form.reset();
      else setError(res.error);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-2"
    >
      <input type="hidden" name="project_id" value={projectId} />

      <div className="sm:col-span-2">
        <input
          name="creator_username"
          required
          list="creator-username-options"
          autoComplete="off"
          placeholder="Username kreator (mis. vikahere)"
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        />
        <datalist id="creator-username-options">
          {creators.map((c) => (
            <option key={c.id} value={c.username}>{c.name}</option>
          ))}
        </datalist>
        <p className="mt-1 text-xs text-slate-400">
          Ketik untuk mencari — daftar username kreator terdaftar muncul otomatis.
          {note ? ` ${note}` : ""}
        </p>
      </div>

      <input
        name="target_gmv"
        placeholder="Target GMV kreator (Rp, opsional)"
        className="rounded-md border border-slate-300 px-3 py-2"
      />
      <select name="live_type" className="rounded-md border border-slate-300 px-3 py-2">
        <option value="solo">Live solo</option>
        <option value="cohost">Live co-host (cek manual — scale up lebih lama)</option>
      </select>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" name="is_external" /> External (wajib binding TikTok)
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" name="binding_bound" /> Binding TikTok selesai
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 sm:col-span-2"
      >
        {pending ? "Menambahkan…" : "Tambah Peserta"}
      </button>

      {error && <p className="text-xs text-red-700 sm:col-span-2">{error}</p>}
    </form>
  );
}

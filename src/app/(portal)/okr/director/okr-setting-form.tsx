"use client";

import { useState, useTransition } from "react";
import { saveOkrSetting } from "./actions";
import {
  EMPTY_OKR_FIELDS,
  objectiveChoicesFor,
  OkrSettingFields,
  toOkrSettingFormData,
  type ObjectiveOption,
  type OkrSettingFieldValue,
} from "./okr-setting-fields";

/**
 * Form tambah baris OKR Setting (tab Config OKR / Director).
 *
 * Alur pengisian: nama OKR → Objective → Key Result → Target (3 bulan). Field-nya
 * dipakai bersama form edit di tabel (OkrSettingFields), jadi aturan dropdown
 * Objective identik di kedua tempat.
 *
 * Satu Objective boleh punya banyak Key Result: setelah simpan berhasil, nama OKR
 * dan Objective yang dipilih SENGAJA dipertahankan (hanya Key Result + Target yang
 * dikosongkan) supaya Director bisa menambah KR berikutnya tanpa mengisi ulang.
 *
 * Hak akses tetap diputuskan server (requirePermission 'm3.set_target' di server
 * action) — komponen ini tidak memutuskan apa pun.
 */
export function OkrSettingForm({ objectives }: { objectives: ObjectiveOption[] }) {
  const [value, setValue] = useState<OkrSettingFieldValue>(EMPTY_OKR_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const choices = objectiveChoicesFor(objectives, value.okrName);
    const formData = toOkrSettingFormData(value, choices);

    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await saveOkrSetting(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved("Key Result tersimpan — tabel di bawah ikut diperbarui.");
      // Nama OKR & Objective sengaja dibiarkan terisi: KR berikutnya biasanya
      // masih milik Objective yang sama. Objective baru yang barusan disimpan
      // akan dikenali server sebagai Objective yang sama (tidak kembar).
      setValue((v) => ({ ...v, keyResult: "", target: "" }));
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-2">
      <OkrSettingFields value={value} onChange={setValue} objectives={objectives} idPrefix="add" />

      <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Menyimpan…" : "Simpan Key Result"}
        </button>
        <span className="text-xs text-slate-400">
          Simpan berkali-kali untuk menambah KR lain pada Objective yang sama — nama OKR &amp; Objective tetap terisi.
        </span>
        {saved && <span className="text-xs text-green-700">{saved}</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </form>
  );
}

"use client";

import { formatOkrTarget } from "@/lib/utils/format";
import {
  isNewObjectiveMode,
  krDirectionLabel,
  NEW_OBJECTIVE,
  objectiveChoicesFor,
  okrNamesOf,
  type ObjectiveOption,
  type OkrSettingFieldValue,
} from "@/lib/m3/okr-setting";

// Re-export supaya komponen sekitarnya (form tambah, tabel) cukup mengimpor dari
// satu tempat: field + aturannya.
export {
  EMPTY_OKR_FIELDS,
  NEW_OBJECTIVE,
  objectiveChoicesFor,
  okrNamesOf,
  isNewObjectiveMode,
  krDirectionLabel,
  toOkrSettingFormData,
} from "@/lib/m3/okr-setting";
export type { ObjectiveOption, OkrSettingFieldValue, KrDirection } from "@/lib/m3/okr-setting";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";
const labelCls = "text-xs font-medium text-slate-600";
const hint = "mt-1 text-xs text-slate-400";

/**
 * Field OKR Setting (nama OKR, Objective, Key Result, Target, sifat KR) sebagai
 * satu komponen supaya form tambah dan form edit tidak pernah punya aturan
 * berbeda — termasuk aturan dropdown Objective yang menyaring per nama OKR.
 *
 * Parent yang menentukan tata letak (komponen ini merender <div> grid item) dan
 * yang memegang state; komponen ini murni tampilan + onChange.
 */
export function OkrSettingFields({
  value,
  onChange,
  objectives,
  idPrefix,
}: {
  value: OkrSettingFieldValue;
  onChange: (next: OkrSettingFieldValue) => void;
  objectives: ObjectiveOption[];
  /** Pembeda id/htmlFor saat form tambah dan form edit tampil bersamaan. */
  idPrefix: string;
}) {
  const choices = objectiveChoicesFor(objectives, value.okrName);
  const isNew = isNewObjectiveMode(value, choices);
  const set = (patch: Partial<OkrSettingFieldValue>) => onChange({ ...value, ...patch });

  return (
    <>
      {/* a. Nama OKR — short text, free text + saran dari yang sudah ada */}
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-okr-name`}>Nama OKR</label>
        <input
          id={`${idPrefix}-okr-name`}
          value={value.okrName}
          // Objective yang tadi dipilih bisa jadi milik OKR lain setelah nama diganti.
          onChange={(e) => set({ okrName: e.target.value, objectiveId: "" })}
          list={`${idPrefix}-okr-name-options`}
          autoComplete="off"
          maxLength={120}
          required
          placeholder="contoh: OKR divisi CM"
          className={input}
        />
        <datalist id={`${idPrefix}-okr-name-options`}>
          {okrNamesOf(objectives).map((n) => <option key={n} value={n} />)}
        </datalist>
        <p className={hint}>Teks singkat. Nama yang pernah dipakai muncul sebagai saran.</p>
      </div>

      {/* d. Target (3 bulan) — angka, boleh desimal; satuan menentukan tampilan */}
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-target`}>Target (3 bulan)</label>
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-target`}
            value={value.target}
            onChange={(e) => set({ target: e.target.value })}
            inputMode="decimal"
            required
            placeholder="contoh: 85000000"
            className={input}
          />
          <select
            value={value.targetUnit}
            onChange={(e) => set({ targetUnit: e.target.value as OkrSettingFieldValue["targetUnit"] })}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
            aria-label="Satuan target"
          >
            <option value="angka">Angka</option>
            <option value="rupiah">Rupiah</option>
            <option value="persen">Persen</option>
          </select>
        </div>
        <p className={hint}>
          Angka murni, boleh desimal. Satuan hanya mengatur tampilan:{" "}
          {formatOkrTarget(100000000, "rupiah")} / 100 / 15%.
        </p>
      </div>

      {/* b. Objective — dropdown dari yang sudah ada, atau tulis baru (paragraf) */}
      <div className="lg:col-span-2">
        <label className={labelCls} htmlFor={`${idPrefix}-objective`}>Objective</label>
        <select
          id={`${idPrefix}-objective`}
          value={isNew ? NEW_OBJECTIVE : value.objectiveId}
          onChange={(e) => set({ objectiveId: e.target.value })}
          required
          disabled={choices.length === 0}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="">— pilih Objective —</option>
          {choices.map((o) => (
            <option key={o.id} value={String(o.id)}>{o.objective}</option>
          ))}
          <option value={NEW_OBJECTIVE}>+ Objective baru (tulis sendiri)</option>
        </select>
        {isNew && (
          <textarea
            value={value.objectiveNew}
            onChange={(e) => set({ objectiveNew: e.target.value })}
            rows={2}
            required
            maxLength={2000}
            placeholder="contoh: Meningkatkan pertumbuhan kreator ...."
            className={`${input} mt-2`}
          />
        )}
        <p className={hint}>
          {choices.length === 0
            ? "Nama OKR ini belum punya Objective — tulis satu, nanti otomatis jadi pilihan dropdown."
            : "Pilih Objective yang sudah ada, atau \"+ Objective baru\" untuk menambah. Objective baru langsung tersimpan sebagai pilihan berikutnya."}
        </p>
      </div>

      {/* c. Key Result — paragraf, milik Objective yang dipilih di atas */}
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-kr`}>Key Result</label>
        <textarea
          id={`${idPrefix}-kr`}
          value={value.keyResult}
          onChange={(e) => set({ keyResult: e.target.value })}
          rows={2}
          required
          maxLength={2000}
          placeholder="contoh: Total GMV yang dihasilkan oleh creator baru hasil ..."
          className={input}
        />
      </div>

      {/* Sifat KR: arah mana yang dianggap baik — menentukan arti angka target */}
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-direction`}>Sifat KR</label>
        <select
          id={`${idPrefix}-direction`}
          value={value.krDirection}
          onChange={(e) => set({ krDirection: e.target.value as OkrSettingFieldValue["krDirection"] })}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="positif">Positif ↑ (makin tinggi makin baik)</option>
          <option value="negatif">Negatif ↓ (makin rendah makin baik)</option>
        </select>
        <p className={hint}>
          {krDirectionLabel(value.krDirection).hint}{" "}
          {value.krDirection === "negatif"
            ? "Contoh: GMV bocor, jumlah komplain."
            : "Contoh: total GMV, jumlah kreator level 3."}
        </p>
      </div>
    </>
  );
}

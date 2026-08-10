"use client";

import { useMemo, useState, useTransition } from "react";
import { saveOkrSetting } from "./actions";
import { formatOkrTarget } from "@/lib/utils/format";

export interface ObjectiveOption {
  id: number;
  okrName: string;
  objective: string;
}

const NEW_OBJECTIVE = "__baru__";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";
const label = "text-xs font-medium text-slate-600";
const hint = "mt-1 text-xs text-slate-400";

/**
 * Form section "OKR Setting" (tab Config OKR / Director).
 *
 * Alur pengisian: nama OKR → Objective → Key Result → Target (3 bulan).
 * Objective dipilih dari dropdown; kalau belum ada, pilih "Objective baru" dan
 * tulis paragrafnya — begitu tersimpan, Objective itu ikut muncul di dropdown
 * pengisian berikutnya.
 *
 * Satu Objective boleh punya banyak Key Result: setelah simpan berhasil, nama OKR
 * dan Objective yang dipilih SENGAJA dipertahankan (hanya Key Result + Target yang
 * dikosongkan) supaya Director bisa menambah KR berikutnya tanpa mengisi ulang.
 *
 * Hak akses tetap diputuskan server (requirePermission 'm3.set_target' di server
 * action) — komponen ini tidak memutuskan apa pun.
 */
export function OkrSettingForm({ objectives }: { objectives: ObjectiveOption[] }) {
  const [okrName, setOkrName] = useState("");
  const [objectiveId, setObjectiveId] = useState("");
  const [objectiveNew, setObjectiveNew] = useState("");
  const [keyResult, setKeyResult] = useState("");
  const [target, setTarget] = useState("");
  const [targetUnit, setTargetUnit] = useState<"angka" | "rupiah" | "persen">("angka");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Nama OKR yang sudah pernah dipakai — jadi saran <datalist>, tetap free text. */
  const okrNames = useMemo(
    () => [...new Set(objectives.map((o) => o.okrName))].sort((a, b) => a.localeCompare(b, "id")),
    [objectives]
  );

  /**
   * Dropdown Objective hanya menampilkan Objective milik nama OKR yang sedang
   * ditulis — supaya "OKR divisi CM" tidak kebanjiran Objective divisi lain.
   * Nama OKR baru (belum ada di data) otomatis hanya menyisakan opsi "Objective baru".
   */
  const objectiveChoices = useMemo(() => {
    const key = okrName.trim().toLowerCase();
    if (!key) return [];
    return objectives.filter((o) => o.okrName.trim().toLowerCase() === key);
  }, [objectives, okrName]);

  const isNewObjective = objectiveId === NEW_OBJECTIVE || objectiveChoices.length === 0;

  function onOkrNameChange(value: string) {
    setOkrName(value);
    // Objective yang tadi dipilih bisa jadi milik OKR lain setelah nama diganti.
    setObjectiveId("");
    setSaved(null);
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData();
    formData.set("okr_name", okrName);
    // Nama OKR yang diketik harus persis sama dengan milik Objective pilihan —
    // server memverifikasi ulang pasangan ini.
    formData.set("objective_id", isNewObjective ? "" : objectiveId);
    formData.set("objective_new", isNewObjective ? objectiveNew : "");
    formData.set("key_result", keyResult);
    formData.set("target", target);
    formData.set("target_unit", targetUnit);

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
      setKeyResult("");
      setTarget("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-2">
      {/* a. Nama OKR — short text, free text + saran dari yang sudah ada */}
      <div>
        <label className={label} htmlFor="okr-name">Nama OKR</label>
        <input
          id="okr-name"
          value={okrName}
          onChange={(e) => onOkrNameChange(e.target.value)}
          list="okr-name-options"
          autoComplete="off"
          maxLength={120}
          required
          placeholder="contoh: OKR divisi CM"
          className={input}
        />
        <datalist id="okr-name-options">
          {okrNames.map((n) => <option key={n} value={n} />)}
        </datalist>
        <p className={hint}>Teks singkat. Nama yang pernah dipakai muncul sebagai saran.</p>
      </div>

      {/* d. Target (3 bulan) — angka, boleh desimal; satuan menentukan tampilan */}
      <div>
        <label className={label} htmlFor="okr-target">Target (3 bulan)</label>
        <div className="flex gap-2">
          <input
            id="okr-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            required
            placeholder="contoh: 85000000"
            className={input}
          />
          <select
            value={targetUnit}
            onChange={(e) => setTargetUnit(e.target.value as "angka" | "rupiah" | "persen")}
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
        <label className={label} htmlFor="okr-objective">Objective</label>
        <select
          id="okr-objective"
          value={isNewObjective ? NEW_OBJECTIVE : objectiveId}
          onChange={(e) => setObjectiveId(e.target.value)}
          required
          disabled={objectiveChoices.length === 0}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="">— pilih Objective —</option>
          {objectiveChoices.map((o) => (
            <option key={o.id} value={String(o.id)}>{o.objective}</option>
          ))}
          <option value={NEW_OBJECTIVE}>+ Objective baru (tulis sendiri)</option>
        </select>
        {isNewObjective && (
          <textarea
            value={objectiveNew}
            onChange={(e) => setObjectiveNew(e.target.value)}
            rows={2}
            required
            maxLength={2000}
            placeholder="contoh: Meningkatkan pertumbuhan kreator ...."
            className={`${input} mt-2`}
          />
        )}
        <p className={hint}>
          {objectiveChoices.length === 0
            ? "Nama OKR ini belum punya Objective — tulis satu, nanti otomatis jadi pilihan dropdown."
            : "Pilih Objective yang sudah ada, atau \"+ Objective baru\" untuk menambah. Objective baru langsung tersimpan sebagai pilihan berikutnya."}
        </p>
      </div>

      {/* c. Key Result — paragraf, milik Objective yang dipilih di atas */}
      <div className="lg:col-span-2">
        <label className={label} htmlFor="okr-kr">Key Result</label>
        <textarea
          id="okr-kr"
          value={keyResult}
          onChange={(e) => setKeyResult(e.target.value)}
          rows={2}
          required
          maxLength={2000}
          placeholder="contoh: Total GMV yang dihasilkan oleh creator baru hasil ..."
          className={input}
        />
        <p className={hint}>
          Key Result menempel ke Objective di atas. Simpan berkali-kali untuk menambah KR lain
          pada Objective yang sama — nama OKR &amp; Objective tetap terisi.
        </p>
      </div>

      <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Menyimpan…" : "Simpan Key Result"}
        </button>
        {saved && <span className="text-xs text-green-700">{saved}</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </form>
  );
}

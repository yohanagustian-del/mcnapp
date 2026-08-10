/**
 * Pure rules behind the OKR Setting form (src/app/(portal)/okr/director/*).
 *
 * Kept out of the client components so "Objective mana yang boleh dipilih untuk
 * nama OKR ini" and "field apa yang dikirim ke server action" are unit-testable
 * without React — the same split as table-sort.ts vs table-controls.tsx.
 */

/** Satu Objective yang sudah tersimpan (jadi pilihan dropdown). */
export interface ObjectiveOption {
  id: number;
  okrName: string;
  objective: string;
}

/** Nilai satu baris OKR Setting selama diedit (semua string — ini isi form). */
export interface OkrSettingFieldValue {
  okrName: string;
  /** "" = belum dipilih, angka = id Objective, NEW_OBJECTIVE = tulis sendiri. */
  objectiveId: string;
  objectiveNew: string;
  keyResult: string;
  target: string;
  targetUnit: "angka" | "rupiah" | "persen";
}

/** Nilai sentinel dropdown Objective untuk "tulis Objective baru". */
export const NEW_OBJECTIVE = "__baru__";

export const EMPTY_OKR_FIELDS: OkrSettingFieldValue = {
  okrName: "",
  objectiveId: "",
  objectiveNew: "",
  keyResult: "",
  target: "",
  targetUnit: "angka",
};

/**
 * Objective milik nama OKR yang sedang ditulis — pembandingnya case-insensitive
 * supaya "okr divisi cm" tetap menemukan Objective "OKR divisi CM" (server yang
 * mengkanonikalkan ejaannya saat menyimpan). Nama kosong = belum ada pilihan.
 */
export function objectiveChoicesFor(objectives: ObjectiveOption[], okrName: string): ObjectiveOption[] {
  const key = okrName.trim().toLowerCase();
  if (!key) return [];
  return objectives.filter((o) => o.okrName.trim().toLowerCase() === key);
}

/** Nama OKR yang pernah dipakai — saran <datalist>, tetap free text. */
export function okrNamesOf(objectives: ObjectiveOption[]): string[] {
  return [...new Set(objectives.map((o) => o.okrName))].sort((a, b) => a.localeCompare(b, "id"));
}

/**
 * Mode "tulis Objective sendiri": dipilih user lewat dropdown, ATAU nama OKR ini
 * belum punya Objective sama sekali (dropdown-nya kosong, jadi satu-satunya jalan).
 */
export function isNewObjectiveMode(value: OkrSettingFieldValue, choices: ObjectiveOption[]): boolean {
  return value.objectiveId === NEW_OBJECTIVE || choices.length === 0;
}

/**
 * Susun FormData untuk server action — dipakai form tambah maupun form edit, jadi
 * keduanya tidak bisa mengirim bentuk field yang berbeda. Hanya salah satu dari
 * objective_id / objective_new yang pernah terisi.
 */
export function toOkrSettingFormData(value: OkrSettingFieldValue, choices: ObjectiveOption[]): FormData {
  const isNew = isNewObjectiveMode(value, choices);
  const formData = new FormData();
  formData.set("okr_name", value.okrName);
  formData.set("objective_id", isNew ? "" : value.objectiveId);
  formData.set("objective_new", isNew ? value.objectiveNew : "");
  formData.set("key_result", value.keyResult);
  formData.set("target", value.target);
  formData.set("target_unit", value.targetUnit);
  return formData;
}

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

/**
 * Arah Key Result yang dianggap baik:
 *  - positif = makin tinggi makin baik, target jadi batas BAWAH (mis. total GMV).
 *  - negatif = makin rendah makin baik, target jadi batas ATAS  (mis. GMV bocor).
 */
export const KR_DIRECTIONS = ["positif", "negatif"] as const;
export type KrDirection = (typeof KR_DIRECTIONS)[number];

/** Label + penjelasan singkat untuk badge/tabel dan dropdown form. */
export function krDirectionLabel(direction: string | null | undefined): {
  label: string;
  hint: string;
} {
  return direction === "negatif"
    ? { label: "Negatif ↓", hint: "Makin rendah makin baik — target = batas maksimal." }
    : { label: "Positif ↑", hint: "Makin tinggi makin baik — target = batas minimal." };
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
  krDirection: KrDirection;
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
  krDirection: "positif",
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
  formData.set("kr_direction", value.krDirection);
  return formData;
}

/**
 * Periode penugasan OKR: dua tanggal, akhir tidak boleh mendahului awal.
 * Mengembalikan pesan siap tampil, atau null kalau valid. Dipakai form (feedback
 * langsung) dan server action (penjaga sebenarnya) supaya aturannya satu.
 */
export function validateAssignPeriod(
  periodStart: string,
  periodEnd: string
): string | null {
  if (!periodStart || !periodEnd) return "Tanggal awal dan tanggal akhir periode wajib diisi.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return "Format tanggal periode tidak valid.";
  }
  if (periodEnd < periodStart) return "Tanggal akhir periode tidak boleh sebelum tanggal awal.";
  return null;
}

/** Rentang periode untuk badge/tabel, mis. "1 Jul 2026 – 30 Sep 2026". */
export function formatPeriodRange(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined
): string {
  if (!periodStart && !periodEnd) return "periode belum diisi";
  const fmt = (d: string | null | undefined) =>
    d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }) : "?";
  return `${fmt(periodStart)} – ${fmt(periodEnd)}`;
}

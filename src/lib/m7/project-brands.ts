import { brandLeadKey } from "@/lib/leads/bulk-upload-spec";

/**
 * Brand yang bergabung ke Special Project (M7, migrasi 0091).
 *
 * Realisasi = jumlah baris `special_project_brands` per project, dibandingkan dengan
 * `special_projects.target_brands` (diisi di awal, brand-nya dicari BizDev). Jumlahnya
 * SELALU dihitung dari baris — tidak pernah disimpan sebagai angka kedua.
 */

/**
 * Kunci dedup brand di satu project: SAMA dengan kunci Brand Lead Bank (huruf+angka
 * lowercase), jadi "Wardah Official" dan "wardah-official" dianggap brand yang sama.
 */
export const projectBrandKey = brandLeadKey;

export type TargetBrandsParse = { ok: true; value: number | null } | { ok: false; error: string };

/** Isian "Target jumlah brand": kosong = tidak ditargetkan; selain itu bilangan bulat ≥ 1. */
export function parseTargetBrands(raw: FormDataEntryValue | null): TargetBrandsParse {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Target brand harus bilangan bulat ≥ 1" };
  return { ok: true, value: n };
}

/** Warna angka "bergabung / target": kurang dari target = amber, tercapai = hijau. */
export function brandProgressTone(joined: number, target: number | null): string {
  if (!target) return "text-slate-700";
  return joined < target ? "text-amber-700" : "text-green-700";
}

/** Tanggal ISO (YYYY-MM-DD) yang valid; selain itu null. */
export function parseJoinedDate(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Pesan UI saat migrasi 0091 belum di-apply. */
export const MIGRATION_0091_MISSING =
  "Migrasi 0091 belum di-apply (kolom special_projects.target_brands / tabel special_project_brands). Hubungi admin untuk menjalankan migrasinya.";

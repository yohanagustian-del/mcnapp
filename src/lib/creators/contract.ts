// Kontrak kreator: sisa hari + ambang peringatan (PLAN_MSDPS Paket D, R5).
// Satu sumber kebenaran untuk /creators (kolom "Sisa Kontrak"), report M2, dan
// /workspace/acquisition/perpanjangan (CLAUDE.md — jangan hardcode threshold).
//
// Murni (tanpa Supabase/next-headers): dipakai juga dari komponen klien
// (creators-table.tsx), jadi TIDAK boleh mengimpor apa pun server-only di sini —
// itu ada di contract-alerts.ts.

export interface ContractAlertDays {
  /** Sisa hari di bawah ini dianggap "segera habis" (kuning). */
  warning: number;
  /** Sisa hari di bawah ini dianggap mendesak (merah). Selalu <= warning. */
  danger: number;
}

/** Nilai bawaan sebelum migrasi 0075 di-apply / seed app_config hilang (sama seperti
 *  angka lama yang dihardcode di creators-table.tsx sebelum PLAN_MSDPS Paket D). */
export const DEFAULT_CONTRACT_ALERT_DAYS: ContractAlertDays = { warning: 60, danger: 30 };

/** Sisa kontrak dalam hari, atau null kalau salah satu tanggal belum terisi. */
export function contractDays(join: string | null, end: string | null, nowMs: number): number | null {
  if (!join || !end) return null;
  const days = Math.ceil((new Date(end).getTime() - nowMs) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

/**
 * Label + flag "danger" untuk kolom Sisa Kontrak. Butuh join_date DAN
 * contract_end_date terisi: kontrak tanpa salah satu tanggal = data belum
 * lengkap, jadi ditampilkan "—" daripada hitungan yang menyesatkan.
 */
export function contractRemaining(
  join: string | null,
  end: string | null,
  nowMs: number,
  alertDays: ContractAlertDays
): { label: string; danger: boolean } {
  const days = contractDays(join, end, nowMs);
  if (days === null) return { label: "—", danger: false };
  if (days < 0) return { label: `habis ${-days} hr lalu`, danger: true };
  if (days <= alertDays.warning) return { label: `${days} hari`, danger: days <= alertDays.danger };
  return { label: `${Math.floor(days / 30)} bln ${days % 30} hr`, danger: false };
}

/** Bucket filter untuk /workspace/acquisition/perpanjangan. */
export type ContractBucket = "expired" | "danger" | "warning" | "ok" | "unknown";

export function contractBucket(days: number | null, alertDays: ContractAlertDays): ContractBucket {
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= alertDays.danger) return "danger";
  if (days <= alertDays.warning) return "warning";
  return "ok";
}

/**
 * Status Deal Brand (brand_deals.status) — keputusan user 2026-10-20 (docs/DECISIONS.md
 * D-2026-10-20-1, migrasi 0097). Label juga ada di app_config m8.deal_status_options;
 * daftar nilai di sini harus sama dengan CHECK constraint 0097.
 */
import type { SupabaseLikeError } from "@/lib/db/missing-migration";

export const DEAL_STATUSES = ["reguler", "running_1st_month", "retention", "hold", "stop"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: "reguler", label: "Reguler" },
  { value: "running_1st_month", label: "Running Bulan Pertama" },
  { value: "retention", label: "Retention" },
  { value: "hold", label: "Hold" },
  { value: "stop", label: "Stop" },
];

/** Nilai sebelum 0097 (CHECK running|hold|done). */
export type LegacyDealStatus = "running" | "hold" | "done";

const ALIASES: Record<string, DealStatus> = {
  reguler: "reguler",
  regular: "reguler",
  running: "running_1st_month",
  "running 1st month": "running_1st_month",
  "running bulan pertama": "running_1st_month",
  running_1st_month: "running_1st_month",
  retention: "retention",
  hold: "hold",
  stop: "stop",
  done: "stop", // pemetaan nilai lama (0097)
};

/** Teks sheet / nilai lama / nilai baru → status baru; tak dikenal atau kosong → null. */
export function normalizeDealStatus(raw: string | null | undefined): DealStatus | null {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return key ? ALIASES[key] ?? null : null;
}

export function dealStatusLabel(raw: string | null | undefined): string {
  const s = normalizeDealStatus(raw);
  return s ? DEAL_STATUS_OPTIONS.find((o) => o.value === s)!.label : raw?.trim() || "—";
}

/** Status baru → nilai yang diterima DB sebelum 0097 (fallback selama migrasi belum di-apply). */
export function toLegacyDealStatus(status: DealStatus | null): LegacyDealStatus | null {
  if (status === null) return null;
  if (status === "hold") return "hold";
  if (status === "stop") return "done";
  return "running";
}

/** Error insert/update karena CHECK status lama (0097 belum di-apply). */
export function isLegacyStatusCheckError(error: SupabaseLikeError | null | undefined): boolean {
  if (!error) return false;
  return (
    (error.code === "23514" || (error.message ?? "").includes("violates check constraint")) &&
    (error.message ?? "").includes("brand_deals_status_check")
  );
}

/**
 * Jalankan tulis brand_deals; bila DB masih ber-CHECK status lama, ulangi sekali dengan
 * status lama yang setara. Produksi tetap jalan selama 0097 menunggu persetujuan.
 */
export async function writeWithDealStatusFallback<R extends { status?: string | null }>(
  record: R,
  write: (rec: R) => PromiseLike<{ error: SupabaseLikeError | null }>
): Promise<{ error: SupabaseLikeError | null; usedLegacyStatus: boolean }> {
  const first = await write(record);
  if (!isLegacyStatusCheckError(first.error)) return { error: first.error, usedLegacyStatus: false };
  const legacy = toLegacyDealStatus(normalizeDealStatus(record.status ?? null));
  const second = await write({ ...record, status: legacy });
  return { error: second.error, usedLegacyStatus: true };
}

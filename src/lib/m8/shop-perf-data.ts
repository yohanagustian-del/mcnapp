import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelationError } from "@/lib/db/missing-migration";
import type { PeriodSelection } from "./period";

/**
 * Pembaca bersama view grain-periode migrasi 0087 (shop_period_summary /
 * bizdev_brand_perf) untuk summary BizDev, TAP Matchmaking, dan Report Brand v2.
 * Tidak menghitung ulang — hanya memfilter periode & menangani "migrasi belum ada".
 */

export function periodKey(sel: PeriodSelection): { kind: "week" | "month"; key: string } {
  return sel.kind === "week" ? { kind: "week", key: sel.periodStart } : { kind: "month", key: sel.monthStart };
}

const PAGE = 1000;

type FilterQ = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/** Semua baris view untuk satu periode (paginasi 1000/halaman). `missing` = migrasi 0087 belum di-apply. */
export async function loadPeriodView<T>(
  client: SupabaseClient,
  view: "bizdev_brand_perf" | "shop_period_summary" | "creator_shop_perf",
  columns: string,
  sel: PeriodSelection,
  extra: (q: FilterQ) => FilterQ = (q) => q
): Promise<{ rows: T[]; missing: boolean }> {
  const { kind, key } = periodKey(sel);
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const base = (client.from(view as string).select(columns) as unknown as FilterQ)
      .eq("period_kind", kind)
      .eq("period_key", key);
    const { data, error } = await extra(base).range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) {
      if (isMissingRelationError(error)) return { rows: [], missing: true };
      throw new Error(`Gagal memuat ${view}: ${error.message}`);
    }
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return { rows, missing: false };
  }
}

/**
 * Ada data mingguan versi lama (creator_period_summary) untuk periode ini? Dipakai
 * membedakan "belum ada upload" dari "data periode ini belum diupload dengan versi
 * baru" (batch sebelum migrasi 0087 tidak punya baris per shop — Q6).
 */
export async function hasLegacyPeriodData(client: SupabaseClient, sel: PeriodSelection, platform?: string): Promise<boolean> {
  let q = client.from("creator_period_summary").select("id", { count: "exact", head: true });
  if (sel.kind === "week") q = q.eq("period_start", sel.periodStart);
  else {
    const [y, m] = sel.month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    q = q.gte("period_start", sel.monthStart).lt("period_start", next);
  }
  if (platform) q = q.eq("platform", platform);
  const { count } = await q;
  return (count ?? 0) > 0;
}

export const LEGACY_PERIOD_MESSAGE =
  "Data periode ini belum diupload dengan versi baru — upload ulang file mingguan periode ini di menu Upload Data Platform Mingguan supaya angka per shop terisi.";

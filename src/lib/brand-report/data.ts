import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllIn } from "@/lib/supabase/fetch-all";
import { isMissingRelationError, MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import { weeksInMonth, type PeriodSelection } from "@/lib/m8/period";
import { loadPeriodView } from "@/lib/m8/shop-perf-data";
import type { BrandReportCreatorRow, BrandReportInput, BrandReportProductRow, BrandReportWeekRow } from "./build";

/**
 * Pemuat data Report Brand v2: hanya MEMBACA view/tabel sumber (creator_shop_perf,
 * shop_period_summary, shop_key_map, products_tap) — angka tidak dihitung ulang.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");
const weekKey = (month: string, w: number) => `${month}-${pad2(1 + (w - 1) * 7)}`;

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/**
 * Minggu (period_key) untuk tren: bulan → semua minggu bulan itu; minggu → minggu
 * sebelumnya (bisa W terakhir bulan lalu) + minggu itu, sebagai pembanding WoW.
 */
export function trendWeekKeys(sel: PeriodSelection): string[] {
  if (sel.kind === "month") return weeksInMonth(sel.month).map((w) => weekKey(sel.month, w));
  if (sel.week > 1) return [weekKey(sel.month, sel.week - 1), sel.periodStart];
  const pm = prevMonth(sel.month);
  const weeks = weeksInMonth(pm);
  return [weekKey(pm, weeks[weeks.length - 1]), sel.periodStart];
}

/** Rentang tanggal report (end eksklusif, sama dengan kolom brand_reports v1). */
export function reportPeriodRange(sel: PeriodSelection): { start: string; endExclusive: string } {
  if (sel.kind === "month") return { start: sel.monthStart, endExclusive: nextMonthStart(sel.month) };
  const monthEnd = nextMonthStart(sel.month);
  const weekEnd = addDays(sel.periodStart, 7);
  // W5 (29–akhir bulan) dan W4 Februari berhenti di akhir bulan.
  return { start: sel.periodStart, endExclusive: weekEnd < monthEnd ? weekEnd : monthEnd };
}

export type BrandReportLoad =
  | { ok: true; input: Omit<BrandReportInput, "adsSpend" | "upgrade" | "topCreators" | "untappedCreatorGmvMin"> }
  | { ok: false; message: string; missing?: boolean };

export async function loadBrandReportSource(
  client: SupabaseClient,
  platform: string,
  shopId: string,
  sel: PeriodSelection,
  todayIso: string
): Promise<BrandReportLoad> {
  const perf = await loadPeriodView<BrandReportCreatorRow & { shop_name: string | null }>(
    client, "creator_shop_perf",
    "creator_id, shop_name, gmv_mcn, gmv_mcn_live, gmv_mcn_video, orders_mcn, gmv_tap, gmv_tap_live, gmv_tap_video, orders_tap, actual_partner_commission",
    sel,
    (q) => q.eq("platform", platform).eq("shop_id", shopId)
  );
  if (perf.missing) return { ok: false, message: MIGRATION_0087_MISSING, missing: true };
  if (perf.rows.length === 0) {
    return { ok: false, message: `Belum ada data kreator MCN untuk shop ${shopId} (${platform}) pada periode ini.` };
  }

  const { data: weeks, error: weekErr } = await client
    .from("shop_period_summary")
    .select("period_key, gmv_mcn, gmv_tap, creator_count")
    .eq("platform", platform)
    .eq("shop_id", shopId)
    .eq("period_kind", "week")
    .in("period_key", trendWeekKeys(sel));
  if (weekErr) {
    if (isMissingRelationError(weekErr)) return { ok: false, message: MIGRATION_0087_MISSING, missing: true };
    throw new Error(`Gagal memuat tren mingguan: ${weekErr.message}`);
  }

  // Satu shop_id bisa punya beberapa shop_key (ejaan Shop Name berbeda, K5 = C): report
  // memakai kunci pertama (urut abjad) sebagai pemilik, produk dari SEMUA kuncinya.
  const { data: keyRows } = await client
    .from("shop_key_map").select("shop_key").eq("platform", platform).eq("shop_id", shopId).order("shop_key");
  const shopKeys = ((keyRows ?? []) as { shop_key: string | null }[])
    .map((k) => k.shop_key)
    .filter((k): k is string => !!k);
  const shopKey = shopKeys[0] ?? null;

  let products: BrandReportProductRow[] = [];
  if (shopKeys.length > 0) {
    const { data: prod, error: prodErr } = await client
      .from("products_tap")
      .select("campaign_id, product_id, product_name, price, commission_pct, partner_commission_pct, effective_end, affiliate_gmv, active")
      .in("shop_key", shopKeys)
      .or(`effective_end.is.null,effective_end.gte.${todayIso}`);
    if (prodErr) throw new Error(`Gagal memuat Produk TAP: ${prodErr.message}`);
    products = ((prod ?? []) as (BrandReportProductRow & { active: boolean | null })[])
      .filter((p) => p.active !== false)
      .map(({ active: _active, ...p }) => p);
  }

  const ids = [...new Set(perf.rows.map((r) => r.creator_id).filter((id): id is string => id !== null))];
  const creators = await fetchAllIn<{ id: string; name: string; owner_cpm_id: string | null }>(
    client, "creators", "id, name, owner_cpm_id", "id", ids
  );
  const { data: members } = await client.from("team_members").select("id, name");
  const memberName = new Map((members ?? []).map((m) => [String(m.id), String(m.name)]));
  const creatorInfo = new Map(
    creators.map((c) => [c.id, { name: c.name, cmName: c.owner_cpm_id ? memberName.get(c.owner_cpm_id) ?? null : null }])
  );

  const shopName = perf.rows.map((r) => r.shop_name?.trim()).find((n) => n) ?? `#${shopId}`;
  return {
    ok: true,
    input: {
      shop: { platform, shopId, shopName, shopKey },
      period: { value: sel.value, kind: sel.kind, label: sel.label },
      creators: perf.rows,
      creatorInfo,
      weeks: (weeks ?? []) as BrandReportWeekRow[],
      products,
    },
  };
}

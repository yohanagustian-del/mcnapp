import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { fetchAllIn } from "@/lib/supabase/fetch-all";
import { todayWib } from "@/lib/utils/date";
import { brandLeadSearchPatterns } from "@/lib/leads/brand-lead";
import { PeriodPicker } from "@/components/period-picker";
import { parsePeriodParam, periodOptions } from "@/lib/m8/period";
import { hasLegacyPeriodData, LEGACY_PERIOD_MESSAGE, loadPeriodView } from "@/lib/m8/shop-perf-data";
import { buildTapMatch, type CreatorInfo, type CreatorShopPerfRow } from "@/lib/m8/tap-matchmaking";
import { MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import { TapMatchResultView } from "./result-view";

export const dynamic = "force-dynamic";

const PLATFORMS = ["tiktok", "shopee"] as const;
const rp = (n: unknown) => `Rp${Math.round(Number(n ?? 0)).toLocaleString("id-ID")}`;

interface ShopHit {
  shop_id: string;
  shop_name: string | null;
  creator_count: number | string;
  gmv_mcn: number | string;
}

/**
 * TAP Matchmaking (REVISI_BIZDEV T7): Shop ID / nama toko → kreator yang berjualan di
 * shop itu, dipisah yang sudah pakai TAP (link agency) vs belum. Angka dari view
 * creator_shop_perf / shop_period_summary (migrasi 0087) — 0 LLM, tidak menulis DB.
 */
export default async function TapMatchmakingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; shop?: string; platform?: string; period?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/tap-matchmaking")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const sp = await searchParams;
  const todayIso = todayWib();
  const period = parsePeriodParam(sp.period, todayIso);
  const platform = (PLATFORMS as readonly string[]).includes(sp.platform ?? "") ? (sp.platform as string) : "tiktok";
  const q = (sp.q ?? "").trim();
  const supabase = await createClient();

  // ---- 1. Cari shop (Shop ID persis, atau nama toko ILIKE per kata) ----
  let hits: ShopHit[] = [];
  let missing = false;
  let selectedShop = (sp.shop ?? "").trim();
  if (q && !selectedShop) {
    const isId = /^\d+$/.test(q);
    const res = await loadPeriodView<ShopHit>(
      supabase, "shop_period_summary", "shop_id, shop_name, creator_count, gmv_mcn", period,
      (query) => {
        let x = query.eq("platform", platform);
        if (isId) x = x.eq("shop_id", q);
        else for (const p of brandLeadSearchPatterns(q)) x = x.ilike("shop_name", p);
        return x.order("gmv_mcn", { ascending: false });
      }
    );
    missing = res.missing;
    hits = res.rows;
    if (hits.length === 1) selectedShop = hits[0].shop_id;
  }

  // ---- 2. Shop terpilih → baris per kreator ----
  let result: ReturnType<typeof buildTapMatch> | null = null;
  if (selectedShop && !missing) {
    const res = await loadPeriodView<CreatorShopPerfRow>(
      supabase, "creator_shop_perf",
      "platform, creator_id, shop_id, shop_name, gmv_mcn, gmv_mcn_live, gmv_mcn_video, gmv_tap, gmv_tap_live, gmv_tap_video",
      period,
      (query) => query.eq("platform", platform).eq("shop_id", selectedShop)
    );
    missing = res.missing;
    if (!missing && res.rows.length > 0) {
      const ids = [...new Set(res.rows.map((r) => r.creator_id).filter((id): id is string => id !== null))];
      const creators = await fetchAllIn<{ id: string; name: string; username: string | null; owner_cpm_id: string | null }>(
        supabase, "creators", "id, name, username, owner_cpm_id", "id", ids
      );
      const { data: cms } = await supabase.from("team_members").select("id, name");
      const cmName = new Map((cms ?? []).map((m) => [String(m.id), String(m.name)]));
      const info = new Map<string, CreatorInfo>(
        creators.map((c) => [c.id, { name: c.name, username: c.username, cmName: c.owner_cpm_id ? cmName.get(c.owner_cpm_id) ?? null : null }])
      );
      result = buildTapMatch(res.rows, info);
    }
  }
  const legacyOnly =
    !missing && ((q && hits.length === 0 && !selectedShop) || (selectedShop && !result))
      ? await hasLegacyPeriodData(supabase, period, platform)
      : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">TAP Matchmaking</h1>
        <p className="mt-1 text-sm text-slate-500">
          Masukkan Shop ID atau nama toko → kreator yang berjualan di shop itu: siapa yang sudah memakai link
          TAP (agency), berapa GMV TAP vs GMV MCN-nya, dan siapa yang <strong>belum pakai TAP</strong> — kandidat
          untuk diajak lewat link agency. Data dari upload mingguan; deterministik, tanpa AI.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-xs font-medium text-slate-600">
          Shop ID / nama toko
          <input
            name="q"
            defaultValue={q}
            placeholder="7495123456789 atau Skintific"
            className="mt-1 block w-72 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Platform
          <select name="platform" defaultValue={platform} className="mt-1 block rounded-md border border-slate-300 px-2 py-2 text-sm">
            <option value="tiktok">TikTok</option>
            <option value="shopee">Shopee</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Periode
          <select name="period" defaultValue={period.value} className="mt-1 block rounded-md border border-slate-300 px-2 py-2 text-sm">
            {periodOptions(todayIso).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Cari
        </button>
      </form>

      {missing && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{MIGRATION_0087_MISSING}</p>
      )}

      {!missing && q && !selectedShop && hits.length === 0 && (
        <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {legacyOnly ? LEGACY_PERIOD_MESSAGE : `Tidak ada shop cocok dengan "${q}" di ${platform} untuk ${period.label}.`}
        </p>
      )}

      {!missing && hits.length > 1 && !selectedShop && (
        <section>
          <h2 className="text-lg font-medium">Pilih shop ({hits.length} cocok)</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Shop</th>
                  <th className="px-3 py-2">Shop ID</th>
                  <th className="px-3 py-2 text-right">Kreator</th>
                  <th className="px-3 py-2 text-right">GMV MCN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hits.map((h) => (
                  <tr key={h.shop_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link
                        className="text-blue-700 hover:underline"
                        href={`/tap-matchmaking?${new URLSearchParams({ q, shop: h.shop_id, platform, period: period.value })}`}
                      >
                        {h.shop_name ?? `#${h.shop_id}`}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{h.shop_id}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(h.creator_count).toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rp(h.gmv_mcn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!missing && selectedShop && !result && (
        <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {legacyOnly ? LEGACY_PERIOD_MESSAGE : `Belum ada GMV kreator di shop ${selectedShop} untuk ${period.label}.`}
        </p>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              <strong>{result.shopName || `#${selectedShop}`}</strong> · Shop ID {selectedShop} · {platform} · {period.label}
            </p>
            <PeriodPicker
              value={period.value}
              options={periodOptions(todayIso)}
              hidden={{ q, shop: selectedShop, platform }}
            />
          </div>
          <TapMatchResultView result={result} fileName={`tap-matchmaking_${selectedShop}_${period.value}.csv`} />
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { todayWib } from "@/lib/utils/date";
import { brandLeadSearchPatterns } from "@/lib/leads/brand-lead";
import { parsePeriodParam, periodOptions } from "@/lib/m8/period";
import { hasLegacyPeriodData, LEGACY_PERIOD_MESSAGE, loadPeriodView } from "@/lib/m8/shop-perf-data";
import { isMissingRelationError, MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import { GenerateBrandReportForm } from "./generate-form";

export const dynamic = "force-dynamic";

const PLATFORMS = ["tiktok", "shopee"] as const;
const rp = (n: unknown) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

interface ShopHit {
  shop_id: string;
  shop_name: string | null;
  creator_count: number | string;
  gmv_mcn: number | string;
  gmv_tap: number | string | null;
}

interface ReportListRow {
  id: number;
  schema_version?: number;
  status?: string;
  platform?: string | null;
  period_start: string;
  period_end: string;
  token_used: number | null;
  created_at: string;
  data_json: {
    shop?: { shop_name?: string };
    period?: { label?: string };
    totals?: { gmv?: number; gmv_mcn?: number };
    upgrade_recommendation?: boolean;
  } | null;
  brand_deals: { brand_name?: string } | null;
}

/**
 * Report Brand v2 (REVISI_BIZDEV T9): cari shop → generate report per periode dari data
 * upload mingguan (view migrasi 0087), 0 LLM. Report lama (v1, per deal + upload file)
 * tetap tampil di daftar dan bisa dibuka read-only.
 */
export default async function BrandReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; platform?: string; period?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/brand-reports")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const sp = await searchParams;
  const todayIso = todayWib();
  const period = parsePeriodParam(sp.period, todayIso);
  const platform = (PLATFORMS as readonly string[]).includes(sp.platform ?? "") ? (sp.platform as string) : "tiktok";
  const q = (sp.q ?? "").trim();
  const supabase = await createClient();

  let hits: ShopHit[] = [];
  let missing = false;
  if (q) {
    const isId = /^\d+$/.test(q);
    const res = await loadPeriodView<ShopHit>(
      supabase, "shop_period_summary", "shop_id, shop_name, creator_count, gmv_mcn, gmv_tap", period,
      (query) => {
        let x = query.eq("platform", platform);
        if (isId) x = x.eq("shop_id", q);
        else for (const p of brandLeadSearchPatterns(q)) x = x.ilike("shop_name", p);
        return x.order("gmv_mcn", { ascending: false }).limit(50);
      }
    );
    missing = res.missing;
    hits = res.rows;
  }
  const legacyOnly = q && !missing && hits.length === 0 ? await hasLegacyPeriodData(supabase, period, platform) : false;

  // Daftar report: kolom v2 (0087) dulu; migrasi belum ada → kolom v1 saja.
  const V1_COLS = "id, period_start, period_end, token_used, created_at, data_json, brand_deals(brand_name)";
  let reportsMissing = false;
  let reports: ReportListRow[] = [];
  const v2 = await supabase
    .from("brand_reports")
    .select(`${V1_COLS}, schema_version, status, platform`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (v2.error && isMissingRelationError(v2.error)) {
    reportsMissing = true;
    const v1 = await supabase.from("brand_reports").select(V1_COLS).order("created_at", { ascending: false }).limit(50);
    reports = (v1.data ?? []) as unknown as ReportListRow[];
  } else {
    reports = (v2.data ?? []) as unknown as ReportListRow[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Report Brand</h1>
        <p className="mt-1 text-sm text-slate-500">
          Report performa brand per shop dari data upload mingguan: GMV kreator MCN, GMV lewat link agency (TAP),
          live vs video, top kreator, Produk TAP aktif, tren minggu ke minggu, dan saran upgrade service. Semua
          angka &amp; kalimat deterministik (tanpa AI); tim bisa menyunting teksnya, angkanya tidak.
        </p>
      </div>

      {(missing || reportsMissing) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{MIGRATION_0087_MISSING}</p>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Buat report baru</h2>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block text-xs font-medium text-slate-600">
            Shop ID / nama toko
            <input name="q" defaultValue={q} placeholder="7495123456789 atau Skintific" className="mt-1 block w-72 rounded-md border border-slate-300 px-3 py-2 text-sm" />
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
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200">Cari shop</button>
        </form>

        {q && !missing && hits.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            {legacyOnly ? LEGACY_PERIOD_MESSAGE : `Tidak ada shop cocok dengan "${q}" di ${platform} untuk ${period.label}.`}
          </p>
        )}
        {hits.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Shop</th><th className="px-3 py-2">Kreator</th>
                  <th className="px-3 py-2">GMV MCN</th><th className="px-3 py-2">GMV TAP</th>
                  <th className="px-3 py-2">Generate ({period.label})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hits.map((h) => (
                  <tr key={h.shop_id}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{h.shop_name ?? "—"}</span>
                      <span className="block font-mono text-xs text-slate-400">{h.shop_id}</span>
                    </td>
                    <td className="px-3 py-2">{Number(h.creator_count)}</td>
                    <td className="px-3 py-2">{rp(h.gmv_mcn)}</td>
                    <td className="px-3 py-2">{h.gmv_tap === null ? "belum tersedia" : rp(h.gmv_tap)}</td>
                    <td className="px-3 py-2">
                      <GenerateBrandReportForm platform={platform} shopId={h.shop_id} period={period.value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Report tersimpan</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Brand</th><th className="px-4 py-3">Periode</th>
                <th className="px-4 py-3">GMV MCN</th><th className="px-4 py-3">Versi</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3">Upgrade?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.map((r) => {
                const isV2 = (r.schema_version ?? 1) >= 2;
                const d = r.data_json ?? {};
                const name = isV2 ? d.shop?.shop_name : r.brand_deals?.brand_name;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/brand-reports/${r.id}`} className="underline">{name ?? `Report #${r.id}`}</Link>
                    </td>
                    <td className="px-4 py-2">{isV2 && d.period?.label ? d.period.label : `${r.period_start} → ${r.period_end}`}</td>
                    <td className="px-4 py-2">{rp(isV2 ? d.totals?.gmv_mcn : d.totals?.gmv)}</td>
                    <td className="px-4 py-2 text-xs">{isV2 ? "v2" : "v1 (lama, read-only)"}</td>
                    <td className="px-4 py-2 text-xs">{isV2 ? (r.status === "final" ? "Final" : "Draft") : "—"}</td>
                    <td className="px-4 py-2">
                      {d.upgrade_recommendation ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">✦ layak upgrade</span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
              {reports.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Belum ada report brand.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import { notFound } from "next/navigation";
import { requireMember } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { creatorSegmentMap, matchProductsForCreator, type CreatorSegmentRow, type ProductRow } from "@/lib/m10/match";
import type { PriceSegment } from "@/lib/projection/gmv";
import {
  availableMonths,
  buildMonthlyGrowth,
  type WeeklyGrowthInputRow,
} from "@/lib/m8/weekly-growth";
import { WeeklyGmvChart } from "./weekly-gmv-chart";

export const dynamic = "force-dynamic";

function formatRp(v: number | null | undefined): string {
  return v != null ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

function formatPct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;
}

const WEEK_LABELS = ["W1", "W2", "W3", "W4", "W5"] as const;

const SEGMENTS: PriceSegment[] = ["low", "entry", "sweet", "high", "premium"];
const SEGMENT_LABEL: Record<PriceSegment, string> = {
  low: "Low",
  entry: "Entry",
  sweet: "Sweet",
  high: "High",
  premium: "Premium",
};

export default async function CreatorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ bulan?: string }>;
}) {
  await requireMember();
  const { id } = await params;
  const { bulan: bulanParam } = await searchParams;

  const supabase = await createClient();
  const { data: creator } = await supabase
    .from("creators")
    .select(
      "id, name, username, platform, jenis_creator, level, niche, top_niches, status, gmv, gmv_live, gmv_video, commission_share, followers"
    )
    .eq("id", id)
    .maybeSingle();

  if (!creator) notFound();

  // ===== Pertumbuhan GMV Mingguan (W1-W5) — pemilih bulan =====
  // All periods for this creator (only needed to list available months + build
  // the selected month's chart) — one creator, so no need for the 1000-row
  // global cap pattern used in the CM Workspace list view.
  const { data: allPeriodRows } = await supabase
    .from("creator_period_summary")
    .select("period_start, period_end, affiliate_gmv, created_at")
    .eq("creator_id", id)
    .order("period_start", { ascending: false })
    .limit(500);
  const periodInputRows: WeeklyGrowthInputRow[] = (allPeriodRows ?? []).map((r) => ({
    creatorId: id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    affiliateGmv: Number(r.affiliate_gmv ?? 0),
    createdAt: r.created_at,
  }));
  const growthMonths = availableMonths(periodInputRows);
  const selectedMonth = bulanParam?.trim() || growthMonths[0] || null;
  const monthlyGrowth = selectedMonth
    ? buildMonthlyGrowth(periodInputRows, selectedMonth).get(id) ?? null
    : null;
  const chartData = WEEK_LABELS.map((label, i) => ({
    week: label,
    gmv: monthlyGrowth?.weeks[i] ?? null,
  }));

  // latest window_end for this creator's segment data (Module 0.5 ingest output).
  const { data: latestRow } = await supabase
    .from("creator_subcat_segment_gmv")
    .select("window_end")
    .eq("creator_id", id)
    .order("window_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  const windowEnd = latestRow?.window_end ?? null;

  const segmentRows: CreatorSegmentRow[] = windowEnd
    ? ((
        await supabase
          .from("creator_subcat_segment_gmv")
          .select("level2_category, price_segment, gmv, live_gmv, items_sold, avg_price")
          .eq("creator_id", id)
          .eq("window_end", windowEnd)
      ).data ?? [])
    : [];

  const matrix = creatorSegmentMap(segmentRows);

  // top level-2 categories by GMV (rows for the matrix table)
  const topCategories = [...matrix.byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cat]) => cat);

  // dominant cell (highest GMV overall) for the highlight.
  let dominantKey: string | null = null;
  let dominantGmv = 0;
  for (const [key, cell] of matrix.cells) {
    if (cell.gmv > dominantGmv) {
      dominantGmv = cell.gmv;
      dominantKey = key;
    }
  }

  // ---- top-10 recommended TAP products ----
  const { data: productRows } = await supabase
    .from("products_tap")
    .select("product_id, product_name, shop_id, shop_name, level2_category, price_segment, price, commission_pct")
    .eq("active", true)
    .limit(2000);

  const products: ProductRow[] = (productRows ?? []).map((p) => ({
    productId: p.product_id,
    productName: p.product_name,
    shopId: p.shop_id,
    shopName: p.shop_name,
    level2Category: p.level2_category,
    priceSegment: p.price_segment as PriceSegment | null,
    price: p.price,
    commissionPct: p.commission_pct,
  }));

  const recommendations = matchProductsForCreator(matrix, products, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{creator.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {creator.username ? `@${creator.username} · ` : ""}
          {creator.platform ?? "—"} · {creator.jenis_creator ?? "—"} · Level {creator.level ?? "—"} ·{" "}
          {creator.status}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">GMV Total</p>
          <p className="text-lg font-semibold">{formatRp(creator.gmv)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">GMV Live</p>
          <p className="text-lg font-semibold">{formatRp(creator.gmv_live)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">GMV Video</p>
          <p className="text-lg font-semibold">{formatRp(creator.gmv_video)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-500">Sharing Komisi</p>
          <p className="text-lg font-semibold">
            {creator.commission_share != null
              ? `${Number((creator.commission_share <= 1 ? creator.commission_share * 100 : creator.commission_share)).toFixed(1)}%`
              : "—"}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Pertumbuhan GMV Mingguan</h2>
          {growthMonths.length > 0 && (
            <form method="get" className="flex items-center gap-2 text-sm">
              <label htmlFor="bulan" className="text-xs text-slate-500">Bulan</label>
              <select
                id="bulan"
                name="bulan"
                defaultValue={selectedMonth ?? ""}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                {growthMonths.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
              >
                Tampilkan
              </button>
            </form>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          GMV affiliate per minggu (W1-W5) dari creator_period_summary. 0 token AI (agregasi
          deterministik, share dengan CM Workspace).
        </p>
        {!selectedMonth || !monthlyGrowth ? (
          <p className="mt-4 text-sm text-slate-500">
            Belum ada data GMV mingguan untuk creator ini — upload data platform via /ingest.
          </p>
        ) : (
          <>
            <div className="mt-4">
              <WeeklyGmvChart data={chartData} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-500">Total Bulan {selectedMonth}</p>
                <p className="text-lg font-semibold">{formatRp(monthlyGrowth.monthTotal)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-500">Growth (minggu pertama → terakhir)</p>
                <p className={`text-lg font-semibold ${monthlyGrowth.monthGrowthPct !== null && monthlyGrowth.monthGrowthPct < 0 ? "text-red-600" : "text-green-700"}`}>
                  {formatPct(monthlyGrowth.monthGrowthPct)}
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium">Matriks Kategori × Segmen Harga</h2>
        <p className="mt-1 text-xs text-slate-500">
          Window terbaru: {windowEnd ?? "belum ada data"}. Baris = kategori Level 2 teratas by GMV, kolom
          = 5 segmen harga. Cell = GMV (avg harga). Cell dominan (GMV tertinggi) di-highlight.
        </p>
        {topCategories.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Belum ada data kategori×segmen untuk creator ini — upload data platform via /ingest.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Kategori (Level 2)</th>
                  {SEGMENTS.map((s) => (
                    <th key={s} className="px-3 py-2">{SEGMENT_LABEL[s]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topCategories.map((cat) => (
                  <tr key={cat}>
                    <td className="px-3 py-2 font-medium capitalize">{cat}</td>
                    {SEGMENTS.map((s) => {
                      const key = `${cat}|${s}`;
                      const cell = matrix.cells.get(key);
                      const isDominant = key === dominantKey;
                      return (
                        <td
                          key={s}
                          className={`px-3 py-2 ${isDominant ? "bg-emerald-100 font-semibold text-emerald-800" : ""}`}
                        >
                          {cell ? (
                            <>
                              {formatRp(cell.gmv)}
                              <span className="block text-xs text-slate-400">
                                avg {formatRp(cell.avgPrice)}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium">Rekomendasi Produk TAP</h2>
        <p className="mt-1 text-xs text-slate-500">
          Top-10 produk TAP paling cocok dengan kemampuan jual creator (skor = share GMV creator di
          sel kategori×segmen produk; fallback segmen bertetangga bila sel persis kosong). 0 token AI.
        </p>
        {recommendations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Belum ada rekomendasi — perlu data segmen creator dan/atau katalog Produk TAP (/products).
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Produk</th>
                  <th className="px-3 py-2">Shop</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2">Segmen</th>
                  <th className="px-3 py-2">Komisi</th>
                  <th className="px-3 py-2">Skor</th>
                  <th className="px-3 py-2">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recommendations.map((r) => (
                  <tr key={r.product.productId}>
                    <td className="px-3 py-2 font-medium">
                      {r.product.productName ?? "—"}
                      <span className="ml-1 font-mono text-[10px] text-slate-400">{r.product.productId}</span>
                    </td>
                    <td className="px-3 py-2">{r.product.shopName ?? r.product.shopId}</td>
                    <td className="px-3 py-2">{r.product.level2Category ?? "—"}</td>
                    <td className="px-3 py-2">{SEGMENT_LABEL[r.matchedSegment]}</td>
                    <td className="px-3 py-2">
                      {r.product.commissionPct != null ? `${Number(r.product.commissionPct).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-2">{(r.score * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-xs">
                      {r.reason === "exact_cell" ? "Sel persis" : "Segmen bertetangga"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import type { BrandReportData } from "@/lib/brand-report/build";
import type { BrandReportTexts } from "@/lib/brand-report/rules";

/**
 * Tampilan Report Brand v2 (REVISI_BIZDEV T9). Angka dari data_json (hasil generate),
 * teks dari kalimat aturan / suntingan tim. Tidak menghitung apa pun selain format.
 */

const TABS = [
  { key: "ringkasan", label: "Ringkasan" },
  { key: "kreator", label: "Kreator" },
  { key: "konten", label: "Live vs Video" },
  { key: "produk", label: "Produk TAP" },
  { key: "upgrade", label: "Rekomendasi upgrade" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const rp = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;
const pct = (x: number | null | undefined) =>
  x === null || x === undefined ? "—" : `${(x * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const NA_TAP = "belum tersedia";

export function BrandReportView({ data, texts }: { data: BrandReportData; texts: BrandReportTexts }) {
  const [tab, setTab] = useState<TabKey>("ringkasan");
  const t = data.totals;

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => setTab(x.key)}
            className={`-mb-px rounded-t-md border px-3 py-2 text-sm ${
              tab === x.key ? "border-slate-200 border-b-white bg-white font-medium" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white p-4">
        {tab === "ringkasan" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-800">{texts.summary}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="GMV MCN" value={rp(t.gmv_mcn)} />
              <Kpi label="GMV TAP" value={t.gmv_tap === null ? NA_TAP : rp(t.gmv_tap)} />
              <Kpi label="% TAP" value={pct(t.tap_share)} />
              <Kpi label="Order MCN" value={t.orders_mcn.toLocaleString("id-ID")} />
              <Kpi label="Kreator" value={String(t.creator_count)} />
              <Kpi label="Kreator pakai TAP" value={t.gmv_tap === null ? NA_TAP : String(t.creator_tap_count)} />
              <Kpi label="Actual revenue partner" value={rp(t.actual_partner_commission)} />
              <Kpi label="Tren WoW" value={data.wow_growth === null ? "—" : `${data.wow_growth >= 0 ? "+" : ""}${pct(data.wow_growth)}`} />
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>{texts.insight_tap}</li>
              <li>{texts.insight_growth}</li>
              <li>{texts.insight_content}</li>
              <li>{texts.insight_products}</li>
            </ul>
            <Table
              head={["Minggu", "GMV MCN", "GMV TAP", "Kreator"]}
              rows={data.trend.map((w) => [w.period_key, rp(w.gmv_mcn), w.gmv_tap === null ? NA_TAP : rp(w.gmv_tap), String(w.creator_count)])}
              empty="Belum ada data mingguan."
            />
          </div>
        )}

        {tab === "kreator" && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Top {data.top_creators.length} kreator (GMV MCN)</h3>
            <Table
              head={["Kreator", "CM", "GMV MCN", "GMV TAP", "Live", "Video", "Order"]}
              rows={data.top_creators.map((c) => [
                <Link key={c.creatorId} href={`/creators/${c.creatorId}`} className="underline">{c.name}</Link>,
                c.cmName ?? "—",
                rp(c.gmvMcn),
                c.gmvTap === null ? NA_TAP : rp(c.gmvTap),
                rp(c.gmvLive),
                rp(c.gmvVideo),
                c.orders.toLocaleString("id-ID"),
              ])}
              empty="Belum ada kreator."
            />
            <h3 className="text-sm font-semibold">Kreator belum pakai TAP ({data.untapped.count})</h3>
            <p className="text-sm text-slate-700">{texts.recommendation_tap}</p>
            {data.untapped.creators.length > 0 && (
              <Table
                head={["Kreator", "CM", "GMV MCN"]}
                rows={data.untapped.creators.map((c) => [c.name, c.cmName ?? "—", rp(c.gmvMcn)])}
                empty=""
              />
            )}
          </div>
        )}

        {tab === "konten" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-800">{texts.insight_content}</p>
            <Table
              head={["Sumber", "GMV MCN", "% GMV MCN", "GMV TAP"]}
              rows={[
                ["Live", rp(t.gmv_mcn_live), pct(t.live_share), t.gmv_tap_live === null ? NA_TAP : rp(t.gmv_tap_live)],
                ["Video", rp(t.gmv_mcn_video), pct(t.video_share), t.gmv_tap_video === null ? NA_TAP : rp(t.gmv_tap_video)],
              ]}
              empty=""
            />
          </div>
        )}

        {tab === "produk" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-800">{texts.insight_products}</p>
            <Table
              head={["Produk", "Harga", "Komisi kreator", "Komisi partner", "Berlaku s/d", "GMV TAP"]}
              rows={data.tap_products.map((p) => [
                p.product_name ?? p.product_id,
                rp(p.price),
                p.commission_pct === null ? "—" : `${p.commission_pct}%`,
                p.partner_commission_pct === null ? "—" : `${p.partner_commission_pct}%`,
                p.effective_end ?? "—",
                rp(p.gmv_tap),
              ])}
              empty="Belum ada kartu Produk TAP aktif."
            />
          </div>
        )}

        {tab === "upgrade" && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Ads spend (manual)" value={rp(data.ads_spend)} />
              <Kpi label="ROAS" value={data.roas === null ? "—" : data.roas.toFixed(2)} />
              <Kpi label="Ambang ROAS" value={String(data.upgrade_thresholds.roas_min)} />
              <Kpi label="Ambang GMV" value={rp(data.upgrade_thresholds.gmv_min)} />
            </div>
            {data.upgrade_recommendation && (
              <p className="inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">✦ layak upgrade service</p>
            )}
            <p className="text-slate-800">{texts.recommendation_upgrade}</p>
            <p className="text-slate-800">{texts.recommendation_tap}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>{head.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="px-3 py-2">{c}</td>)}</tr>
          ))}
          {rows.length === 0 && empty && (
            <tr><td colSpan={head.length} className="px-3 py-4 text-center text-slate-400">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

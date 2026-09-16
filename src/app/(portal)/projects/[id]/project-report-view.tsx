"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectReportData } from "@/lib/m7/report-data";

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const rupiahAxis = (v: number) => {
  if (Math.abs(v) >= 1_000_000_000) return `Rp${(v / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000_000) return `Rp${(v / 1_000_000).toFixed(0)}jt`;
  if (Math.abs(v) >= 1_000) return `Rp${(v / 1_000).toFixed(0)}rb`;
  return String(v);
};

/**
 * Report peserta project (PRD §6.13 tanpa template unduhan — B3 LOCKED): satu
 * komponen dipakai halaman tim (`/projects/[id]/report/[creatorId]`) dan,
 * nanti, tab portal kreator (Fase 1D) — presentasi murni, semua angka SUDAH
 * dihitung server-side (report-data.ts). Insight hanya dari `data_json`, tidak
 * ada angka lain ditampilkan yang tidak berasal dari sana (R27).
 */
export function ProjectReportView({
  data, insight, status,
}: { data: ProjectReportData; insight: string | null; status: "draft" | "final" }) {
  const chartData = data.daily.map((d) => ({ date: d.date.slice(5), gmv: d.gmv }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">MCN MEA · Special Project — {data.period.project_name}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status === "final" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
          {status === "final" ? "Final" : "Draft"}
        </span>
      </div>
      <p className="text-sm text-slate-500">
        {data.period.project_type} · {data.period.start} → {data.period.end}
      </p>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium">{data.creator.name}</p>
          <p className="text-xs text-slate-400">
            {data.creator.niche ?? "—"}{data.creator.level ? ` · Level ${data.creator.level}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">GMV Project</p>
          <p className="mt-1 text-2xl font-semibold">{rupiah(data.metrics.gmv)}</p>
          <p className="text-xs text-slate-400">
            {(data.achievement.personal_pct * 100).toFixed(0)}% dari target pribadi {rupiah(data.target.personal_gmv)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Orders · Items</p>
          <p className="mt-1 text-lg font-semibold">{data.metrics.orders} · {data.metrics.items}</p>
          <p className="text-xs text-slate-400">Live share {(data.metrics.live_share * 100).toFixed(0)}% · {data.metrics.active_days} hari aktif</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Peringkat</p>
          <p className="mt-1 text-lg font-semibold">#{data.achievement.rank} dari {data.achievement.of}</p>
          <p className="text-xs text-slate-400">{(data.achievement.share_of_project * 100).toFixed(1)}% dari total GMV project</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Vs Rata Cohort</p>
          <p className="mt-1 text-lg font-semibold">{rupiah(data.cohort_avg.gmv)}</p>
          <p className="text-xs text-slate-400">
            Live share cohort {(data.cohort_avg.live_share * 100).toFixed(0)}% · {data.cohort_avg.active_days.toFixed(1)} hari aktif rata-rata
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Tren GMV Harian</p>
        <div style={{ height: 220 }} className="rounded-lg border border-slate-200 bg-white p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={rupiahAxis} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v) => [rupiah(Number(v)), "GMV"]} />
              <Bar dataKey="gmv" fill="#0f172a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {data.top_products.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Produk Terlaris</p>
          <ul className="space-y-1 text-sm">
            {data.top_products.map((p, i) => (
              <li key={i} className="flex justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
                <span>{p.name}</span>
                <span className="text-slate-500">{rupiah(p.gmv)} · {p.items} item</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="mb-1 text-sm font-medium">Insight</p>
        {insight ? (
          <p className="whitespace-pre-wrap text-sm text-slate-700">{insight}</p>
        ) : (
          <p className="text-sm text-slate-400">
            {status === "final" ? "Belum ada narasi." : "Draft belum punya insight (data-only)."}
          </p>
        )}
      </div>

      <p className="text-xs text-slate-400">Data: upload tim MCN MEA · #meabikinumkmjadiraja</p>
    </div>
  );
}

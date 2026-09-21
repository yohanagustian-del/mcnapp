import Link from "next/link";
import type { DerivedMetrics } from "@/lib/report/aggregate";
import { FinalizeForm } from "./finalize-form";
import { PrintButton } from "./print-button";

/**
 * Tampilan report M2 versi 1 (sebelum `schema_version: 2`, 2026-09-21).
 * Dipertahankan apa adanya supaya 23 report yang sudah tersimpan tetap terbaca
 * — report baru memakai `CreatorReportView`. Jangan dikembangkan lagi.
 */
export interface LegacyReportDataJson {
  creator: { id: string; name: string; niche: string | null; level: number | null };
  period: { type: string; start: string; end_exclusive: string; prev_start: string };
  metrics: DerivedMetrics;
  previous: DerivedMetrics;
  deltas: Record<string, number | null>;
  gmv_by_source: Record<string, number>;
  top_sub_categories: { sub_category: string; gmv: number }[];
  benchmark: { niche: string; peers: number; peer_avg_gmv: number } | null;
  contract_alert: { contract_end_date: string; expired: boolean } | null;
  link_leakage: { week: string; leak_ratio: number | null; link_status: string } | null;
  level_position: { current_level: number; next_level: number } | null;
}

export interface LegacyReportRow {
  id: number;
  creator_id: string;
  period_type: string;
  period_start: string;
  data_json: unknown;
  insight_draft: string | null;
  insight_final: string | null;
  status: string;
  token_used: number;
}

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Math.round(n).toLocaleString("id-ID");
const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`;

export function LegacyReportView({ report, canFinalize }: { report: LegacyReportRow; canFinalize: boolean }) {
  const d = report.data_json as LegacyReportDataJson | null;

  const metricRows: { label: string; key: keyof DerivedMetrics; fmt: (n: number | null) => string }[] = [
    { label: "GMV", key: "gmv", fmt: rupiah },
    { label: "GMV Live", key: "live_gmv", fmt: rupiah },
    { label: "GMV Video", key: "video_gmv", fmt: rupiah },
    { label: "Orders", key: "orders", fmt: num },
    { label: "Views (video+live)", key: "views", fmt: num },
    { label: "AOV", key: "aov", fmt: rupiah },
    { label: "GPM (GMV/1000 views)", key: "gpm", fmt: rupiah },
    { label: "Konversi view→order", key: "conversion", fmt: (n) => pct(n, 2) },
    { label: "Kontribusi Live", key: "live_share", fmt: (n) => pct(n) },
  ];

  return (
    <div>
      <div className="flex items-center justify-between print:hidden">
        <Link href="/reports" className="text-sm text-slate-500 underline">← Kembali ke daftar</Link>
        {report.status === "final" && <PrintButton />}
      </div>

      <h1 className="mt-2 text-2xl font-semibold">
        Report #{report.id} — {d?.creator.name ?? report.creator_id}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {report.period_type} · periode mulai {report.period_start} · status{" "}
        <span className={report.status === "final" ? "font-medium text-green-700" : "font-medium text-amber-700"}>
          {report.status}
        </span>{" "}
        · {report.token_used} token
        {d?.creator.niche && <> · niche {d.creator.niche}</>}
        {d?.level_position && <> · Level L{d.level_position.current_level} (target L{d.level_position.next_level})</>}
      </p>

      {(d?.contract_alert || d?.link_leakage) && (
        <div className="mt-4 space-y-2">
          {d?.contract_alert && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              ⚠ Kontrak {d.contract_alert.expired ? "SUDAH berakhir" : "hampir berakhir"}: {d.contract_alert.contract_end_date}
            </p>
          )}
          {d?.link_leakage && d.link_leakage.link_status !== "via_agency" && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              ⚠ Status link (M4, minggu {d.link_leakage.week}): {d.link_leakage.link_status}
              {d.link_leakage.leak_ratio !== null && <> — rasio bocor {pct(d.link_leakage.leak_ratio)}</>}
            </p>
          )}
        </div>
      )}

      {d && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Metrik</th>
                  <th className="px-4 py-3">Periode Ini</th>
                  <th className="px-4 py-3">Periode Lalu</th>
                  <th className="px-4 py-3">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metricRows.map(({ label, key, fmt }) => {
                  const delta = d.deltas[key as string];
                  return (
                    <tr key={key}>
                      <td className="px-4 py-2 font-medium">{label}</td>
                      <td className="px-4 py-2">{fmt(d.metrics[key] as number | null)}</td>
                      <td className="px-4 py-2 text-slate-500">{fmt(d.previous[key] as number | null)}</td>
                      <td className={`px-4 py-2 ${delta === null || delta === undefined ? "text-slate-400" : delta >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {delta === null || delta === undefined ? "—" : `${delta >= 0 ? "+" : ""}${pct(delta)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold uppercase text-slate-500">Sumber GMV</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(d.gmv_by_source).map(([src, gmv]) => (
                  <li key={src} className="flex justify-between">
                    <span className="uppercase">{src}</span>
                    <span>{rupiah(gmv)}</span>
                  </li>
                ))}
                {Object.keys(d.gmv_by_source).length === 0 && <li className="text-slate-400">—</li>}
              </ul>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold uppercase text-slate-500">Top Sub-Kategori (Level 2)</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {d.top_sub_categories.map((s) => (
                  <li key={s.sub_category} className="flex justify-between">
                    <span>{s.sub_category}</span>
                    <span>{rupiah(s.gmv)}</span>
                  </li>
                ))}
                {d.top_sub_categories.length === 0 && <li className="text-slate-400">—</li>}
              </ul>
            </div>
            {d.benchmark && (
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold uppercase text-slate-500">Benchmark Peer (anonim)</h2>
                <p className="mt-2 text-sm">
                  Rata-rata GMV {d.benchmark.peers} peer niche “{d.benchmark.niche}”:{" "}
                  <strong>{rupiah(d.benchmark.peer_avg_gmv)}</strong> vs creator ini{" "}
                  <strong>{rupiah(d.metrics.gmv)}</strong>.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Insight</h2>
        {report.status === "final" ? (
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {report.insight_final ?? report.insight_draft ?? "Report data-only (tanpa insight — delta di bawah threshold)."}
          </p>
        ) : canFinalize ? (
          <div className="mt-2">
            <FinalizeForm reportId={report.id} insightDraft={report.insight_draft} />
          </div>
        ) : (
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {report.insight_draft ?? "Report data-only (tanpa insight — delta di bawah threshold)."}
          </p>
        )}
      </div>
    </div>
  );
}

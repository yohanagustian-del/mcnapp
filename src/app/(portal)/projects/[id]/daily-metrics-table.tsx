"use client";

import {
  PAGE_SIZES_10_20_30,
  SortableTh,
  TablePagination,
  useTableControls,
  type SortConfig,
} from "@/components/table-controls";

/**
 * Satu baris Metrik Harian — SUDAH dihitung di server oleh trackDaily()
 * (kumulatif, target kumulatif, gap) + kolom mentah ads/revenue dari
 * project_daily_metrics. Komponen ini hanya menampilkan, mengurutkan, dan
 * memaginasi (CLAUDE.md #4: tidak ada perhitungan ulang di UI).
 */
export interface DailyMetricRow {
  date: string;
  dayIndex: number;
  gmvActual: number;
  cumActual: number;
  cumTarget: number;
  gap: number;
  adsSpend: number | null;
  meaRevenue: number | null;
}

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

/** Tanggal default naik (urutan kalender, sama seperti sebelum ada sort). */
const SORT: SortConfig<DailyMetricRow> = {
  columns: {
    tanggal: { value: (r) => r.date },
    gmv: { value: (r) => r.gmvActual, firstDir: "desc" },
    kumulatif: { value: (r) => r.cumActual, firstDir: "desc" },
    target: { value: (r) => r.cumTarget, firstDir: "desc" },
    gap: { value: (r) => r.gap, firstDir: "desc" },
    ads: { value: (r) => r.adsSpend, firstDir: "desc" },
    revenue: { value: (r) => r.meaRevenue, firstDir: "desc" },
  },
  initial: { key: "tanggal", dir: "asc" },
};

/** Metrik Harian project: klik header untuk urut naik/turun, paginasi 10/20/30. */
export function DailyMetricsTable({ rows }: { rows: DailyMetricRow[] }) {
  const controls = useTableControls<DailyMetricRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_20_30,
    itemLabel: "hari",
  });

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="tanggal">Tanggal</SortableTh>
              <SortableTh controls={controls} sortKey="gmv">GMV</SortableTh>
              <SortableTh controls={controls} sortKey="kumulatif">Kumulatif</SortableTh>
              <SortableTh controls={controls} sortKey="target">Target Kumulatif</SortableTh>
              <SortableTh controls={controls} sortKey="gap">Gap</SortableTh>
              <SortableTh controls={controls} sortKey="ads">Ads</SortableTh>
              <SortableTh controls={controls} sortKey="revenue">Revenue MEA</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => (
              <tr key={r.date}>
                <td className="px-4 py-2">
                  {r.date} <span className="text-xs text-slate-400">H{r.dayIndex}</span>
                </td>
                <td className="px-4 py-2">{rupiah(r.gmvActual)}</td>
                <td className="px-4 py-2">{rupiah(r.cumActual)}</td>
                <td className="px-4 py-2">{rupiah(r.cumTarget)}</td>
                <td className={`px-4 py-2 ${r.gap < 0 ? "text-red-700" : "text-green-700"}`}>
                  {rupiah(r.gap)}
                </td>
                <td className="px-4 py-2">{rupiah(r.adsSpend)}</td>
                <td className="px-4 py-2">{rupiah(r.meaRevenue)}</td>
              </tr>
            ))}
            {controls.total === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Belum ada metrik harian.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {controls.total > 0 && <TablePagination controls={controls} />}
    </div>
  );
}

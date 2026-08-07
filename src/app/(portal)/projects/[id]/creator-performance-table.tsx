"use client";

import {
  PAGE_SIZES_10_50_100,
  SortableTh,
  TablePagination,
  useTableControls,
  type SortConfig,
} from "@/components/table-controls";

/**
 * Satu baris Performa per Kreator — angkanya sudah dijumlahkan di server dari
 * project_creator_metrics (GMV & item per peserta) dan dibandingkan dengan target
 * peserta + total GMV project. Komponen ini hanya urut + paginasi.
 */
export interface CreatorPerformanceRow {
  creatorId: string;
  creatorName: string;
  targetGmv: number | null;
  gmv: number;
  items: number;
  /** GMV / target; null = peserta tanpa target. */
  pctTarget: number | null;
  /** GMV peserta / total GMV project. */
  contribution: number;
}

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

/** GMV aktual default turun: yang paling berkontribusi muncul lebih dulu. */
const SORT: SortConfig<CreatorPerformanceRow> = {
  columns: {
    creator: { value: (r) => r.creatorName },
    target: { value: (r) => r.targetGmv, firstDir: "desc" },
    gmv: { value: (r) => r.gmv, firstDir: "desc" },
    items: { value: (r) => r.items, firstDir: "desc" },
    pct: { value: (r) => r.pctTarget, firstDir: "desc" },
    kontribusi: { value: (r) => r.contribution, firstDir: "desc" },
  },
  initial: { key: "gmv", dir: "desc" },
};

/** Performa per Kreator: klik header untuk urut naik/turun, paginasi 10/50/100. */
export function CreatorPerformanceTable({ rows }: { rows: CreatorPerformanceRow[] }) {
  const controls = useTableControls<CreatorPerformanceRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_50_100,
    itemLabel: "kreator",
  });

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="creator">Creator</SortableTh>
              <SortableTh controls={controls} sortKey="target">Target GMV</SortableTh>
              <SortableTh controls={controls} sortKey="gmv">GMV Aktual</SortableTh>
              <SortableTh controls={controls} sortKey="items">Item Terjual</SortableTh>
              <SortableTh controls={controls} sortKey="pct">% Target</SortableTh>
              <SortableTh controls={controls} sortKey="kontribusi">Kontribusi Project</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => (
              <tr key={r.creatorId}>
                <td className="px-4 py-2 font-medium">
                  {r.creatorName}
                  <span className="ml-1 text-xs text-slate-400">{r.creatorId}</span>
                </td>
                <td className="px-4 py-2">{rupiah(r.targetGmv)}</td>
                <td className="px-4 py-2">{rupiah(r.gmv)}</td>
                <td className="px-4 py-2">{r.items || "—"}</td>
                <td className="px-4 py-2">
                  {r.pctTarget === null ? (
                    "—"
                  ) : (
                    <span
                      className={
                        r.pctTarget >= 1
                          ? "font-medium text-green-700"
                          : r.pctTarget < 0.5
                            ? "text-red-700"
                            : "text-amber-700"
                      }
                    >
                      {(r.pctTarget * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{(r.contribution * 100).toFixed(0)}%</td>
              </tr>
            ))}
            {controls.total === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Belum ada peserta.
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

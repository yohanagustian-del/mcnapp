"use client";

import {
  PAGE_SIZE_10,
  SortableTh,
  TablePagination,
  useTableControls,
  type SortConfig,
} from "@/components/table-controls";

/**
 * Satu baris Performa per CM — ROLLUP dari tabel Performa per Kreator (baris
 * kreator dikelompokkan berdasarkan CM pemiliknya, `creators.owner_cpm_id`).
 * Angkanya sudah dijumlahkan di server; komponen ini hanya urut + paginasi
 * (CLAUDE.md #4: tidak ada perhitungan ulang di UI).
 */
export interface CmPerformanceRow {
  /** team_members.id; null = kumpulan kreator yang belum punya CM. */
  cmId: string | null;
  cmName: string;
  creatorCount: number;
  /** Jumlah target kreator di bawah CM ini; null = tidak ada yang punya target. */
  targetGmv: number | null;
  gmv: number;
  items: number;
  /** GMV / target gabungan; null = tanpa target. */
  pctTarget: number | null;
  /** Jumlah kontribusi kreator-kreatornya terhadap total GMV project. */
  contribution: number;
}

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

/** GMV aktual default turun: CM penyumbang terbesar muncul lebih dulu. */
const SORT: SortConfig<CmPerformanceRow> = {
  columns: {
    cm: { value: (r) => r.cmName },
    kreator: { value: (r) => r.creatorCount, firstDir: "desc" },
    target: { value: (r) => r.targetGmv, firstDir: "desc" },
    gmv: { value: (r) => r.gmv, firstDir: "desc" },
    items: { value: (r) => r.items, firstDir: "desc" },
    pct: { value: (r) => r.pctTarget, firstDir: "desc" },
    kontribusi: { value: (r) => r.contribution, firstDir: "desc" },
  },
  initial: { key: "gmv", dir: "desc" },
};

/** Performa per CM: klik header untuk urut naik/turun, 10 baris per halaman. */
export function CmPerformanceTable({ rows }: { rows: CmPerformanceRow[] }) {
  const controls = useTableControls<CmPerformanceRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "CM",
  });

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="cm">CM</SortableTh>
              <SortableTh controls={controls} sortKey="kreator">Jumlah Kreator</SortableTh>
              <SortableTh controls={controls} sortKey="target">Target GMV</SortableTh>
              <SortableTh controls={controls} sortKey="gmv">GMV Aktual</SortableTh>
              <SortableTh controls={controls} sortKey="items">Item Terjual</SortableTh>
              <SortableTh controls={controls} sortKey="pct">% Target</SortableTh>
              <SortableTh controls={controls} sortKey="kontribusi">Kontribusi Project</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => (
              <tr key={r.cmId ?? "__tanpa_cm__"}>
                <td className="px-4 py-2 font-medium">
                  {r.cmName}
                  {r.cmId === null && (
                    <span className="ml-1 text-xs font-normal text-amber-700">
                      (kreator belum punya CM)
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{r.creatorCount}</td>
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
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
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

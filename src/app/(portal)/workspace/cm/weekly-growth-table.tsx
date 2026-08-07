"use client";

import { useMemo } from "react";
import { rupiah, pct, rupiahRingkas } from "@/lib/utils/format";
import {
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
  type FacetDef,
  type SortConfig,
} from "@/components/table-controls";
import { creatorClassLabel } from "@/lib/creators/creator-class";

const WEEK_LABELS = ["W1", "W2", "W3", "W4", "W5"] as const;

/** Satu baris tabel Pertumbuhan GMV Mingguan (sudah diagregasi server — CLAUDE.md #4). */
export interface WeeklyGrowthRow {
  creatorId: string;
  name: string;
  username: string | null;
  ownerCpmId: string | null;
  cmName: string | null;
  /** creators.creator_class (reguler|top_creator|influencer|eksternal); null = reguler. */
  creatorClass: string | null;
  /** Kategori/niche utama kreator; null = belum ada. */
  kategori: string | null;
  /** GMV per minggu W1..W5, null = tidak ada upload. */
  weeks: (number | null)[];
  /** % perubahan vs minggu terisi sebelumnya, index-aligned dengan `weeks`. */
  deltas: (number | null)[];
  monthTotal: number;
  monthGrowthPct: number | null;
}

/** Trend arrow vs previous filled week: ▲ green up, ▼ red down, − grey flat/first week. */
function TrendCell({ value, delta }: { value: number | null; delta: number | null }) {
  if (value === null) return <span className="text-slate-300">—</span>;
  let arrow = <span className="text-slate-400">−</span>;
  if (delta !== null && delta > 0) arrow = <span className="text-green-600">▲</span>;
  else if (delta !== null && delta < 0) arrow = <span className="text-red-600">▼</span>;
  return (
    <span>
      {rupiahRingkas(value)} {arrow}
    </span>
  );
}

const searchUsername = (r: WeeklyGrowthRow) => r.username;
const rowCm = (r: WeeklyGrowthRow) => ({ id: r.ownerCpmId, name: r.cmName });

/**
 * Filter kelas & kategori kreator. Kelas selalu punya nilai (null = Reguler, sesuai
 * default kolom DB), jadi opsinya tidak pernah kosong; kategori bisa null untuk
 * kreator yang niche-nya belum terisi dari upload mingguan.
 */
const FACETS: FacetDef<WeeklyGrowthRow>[] = [
  {
    key: "kelas",
    label: "Kelas",
    value: (r) => {
      const label = creatorClassLabel(r.creatorClass);
      return { value: label, label };
    },
  },
  {
    key: "kategori",
    label: "Kategori",
    value: (r) => (r.kategori ? { value: r.kategori, label: r.kategori } : null),
    emptyLabel: "Belum ada kategori/niche pada data ini.",
  },
];

/** Kolom yang bisa diurutkan lewat klik header. Angka & % default turun (terbesar dulu). */
const SORT: SortConfig<WeeklyGrowthRow> = {
  columns: {
    kreator: { value: (r) => r.username || r.name },
    kelas: { value: (r) => creatorClassLabel(r.creatorClass) },
    kategori: { value: (r) => r.kategori },
    w1: { value: (r) => r.weeks[0], firstDir: "desc" },
    w2: { value: (r) => r.weeks[1], firstDir: "desc" },
    w3: { value: (r) => r.weeks[2], firstDir: "desc" },
    w4: { value: (r) => r.weeks[3], firstDir: "desc" },
    w5: { value: (r) => r.weeks[4], firstDir: "desc" },
    total: { value: (r) => r.monthTotal, firstDir: "desc" },
    growth: { value: (r) => r.monthGrowthPct, firstDir: "desc" },
  },
  initial: { key: "total", dir: "desc" },
};

/**
 * Pertumbuhan GMV Mingguan (W1-W5) — search username kreator, filter CM / kelas /
 * kategori, urut lewat klik header (naik ⇄ turun), paginasi 10/20/50. Baris TOTAL
 * dihitung dari SELURUH baris yang lolos filter (bukan cuma halaman aktif), jadi
 * angkanya tetap konsisten dengan apa yang sedang difilter.
 */
export function WeeklyGrowthTable({ rows }: { rows: WeeklyGrowthRow[] }) {
  const controls = useTableControls<WeeklyGrowthRow>({
    rows,
    searchText: searchUsername,
    cm: rowCm,
    facets: FACETS,
    sort: SORT,
    itemLabel: "kreator",
  });

  const { weeklyTotals, weeklyTotalDeltas, grandMonthTotal } = useMemo(() => {
    const totals: (number | null)[] = new Array(5).fill(null);
    let grand = 0;
    for (const r of controls.filteredRows) {
      grand += r.monthTotal;
      for (let i = 0; i < 5; i++) {
        if (r.weeks[i] !== null) totals[i] = (totals[i] ?? 0) + (r.weeks[i] as number);
      }
    }
    const deltas: (number | null)[] = new Array(5).fill(null);
    let lastFilledIdx: number | null = null;
    for (let i = 0; i < 5; i++) {
      const v = totals[i];
      if (v === null) continue;
      if (lastFilledIdx !== null) {
        const prev = totals[lastFilledIdx] as number;
        deltas[i] = prev !== 0 ? (v - prev) / prev : null;
      }
      lastFilledIdx = i;
    }
    return { weeklyTotals: totals, weeklyTotalDeltas: deltas, grandMonthTotal: grand };
  }, [controls.filteredRows]);

  return (
    <>
      <TableFilterBar controls={controls} className="mt-3" />

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="kreator">Kreator</SortableTh>
                <SortableTh controls={controls} sortKey="kelas">Kelas</SortableTh>
                <SortableTh controls={controls} sortKey="kategori">Kategori</SortableTh>
                {WEEK_LABELS.map((w, i) => (
                  <SortableTh key={w} controls={controls} sortKey={`w${i + 1}`}>{w}</SortableTh>
                ))}
                <SortableTh controls={controls} sortKey="total">Total Bulan</SortableTh>
                <SortableTh controls={controls} sortKey="growth">Growth</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((r) => (
                <tr key={r.creatorId}>
                  <td className="px-4 py-2 font-medium">
                    {r.name}{" "}
                    {r.username && <span className="text-xs text-slate-500">@{r.username}</span>}{" "}
                    <span className="text-xs text-slate-400">{r.creatorId}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{creatorClassLabel(r.creatorClass)}</td>
                  <td className="px-4 py-2 text-slate-600">{r.kategori ?? "—"}</td>
                  {WEEK_LABELS.map((_, i) => (
                    <td key={i} className="px-4 py-2">
                      <TrendCell value={r.weeks[i]} delta={r.deltas[i]} />
                    </td>
                  ))}
                  <td className="px-4 py-2 font-medium">{rupiah(r.monthTotal)}</td>
                  <td className={`px-4 py-2 ${r.monthGrowthPct !== null && r.monthGrowthPct < 0 ? "text-red-600" : "text-green-700"}`}>
                    {pct(r.monthGrowthPct)}
                  </td>
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada kreator yang cocok dengan pencarian username / filter CM, kelas, atau kategori."
                      : "Belum ada data GMV mingguan untuk bulan ini di scope Anda."}
                  </td>
                </tr>
              )}
            </tbody>
            {controls.total > 0 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-2">TOTAL{controls.filterActive ? " (terfilter)" : ""}</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2" />
                  {WEEK_LABELS.map((_, i) => (
                    <td key={i} className="px-4 py-2">
                      <TrendCell value={weeklyTotals[i]} delta={weeklyTotalDeltas[i]} />
                    </td>
                  ))}
                  <td className="px-4 py-2">{rupiah(grandMonthTotal)}</td>
                  <td className="px-4 py-2">—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <TablePagination controls={controls} />
      </div>
    </>
  );
}

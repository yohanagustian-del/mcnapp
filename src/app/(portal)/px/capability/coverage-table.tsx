"use client";

import { useMemo } from "react";
import {
  PAGE_SIZES_10_20_50_100, SortableTh, TableFilterBar, TablePagination, useTableControls,
  type SortConfig,
} from "@/components/table-controls";
import type { CoverageRow } from "@/lib/px/coverage-export";
import { DownloadCoverageCsvButton } from "./download-coverage-csv-button";

const PRICE_SEGMENT_LABEL: Record<string, string> = {
  low: "Low (<180rb)", entry: "Entry (180rb–800rb)", sweet: "Sweet spot (800rb–3,6jt)",
  high: "High (3,6jt–8jt)", premium: "Premium (>8jt)",
};

function rpShort(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

const td = "px-3 py-2 whitespace-nowrap text-sm";
const th = "px-3 py-3 whitespace-nowrap text-xs font-semibold text-slate-500";

/**
 * Tab Coverage: read-only (bridge.px_coverage_map() lewat wrapper public.px_coverage
 * — SATU sumber, tidak dihitung ulang di sini). Peringatan keterbatasan WAJIB
 * tampil di layar (surat tugas §5 Langkah 6): kategori yang MEA punya NOL
 * kreator tidak muncul sebagai baris "kosong" — ia tidak muncul sama sekali,
 * karena baris ini hanya bisa lahir dari kombinasi yang SUDAH ADA kreatornya.
 * Menutup itu butuh tabel master kategori dari Hans (di luar lingkup PX-M1).
 */
export function CoverageTable({ rows }: { rows: CoverageRow[] }) {
  const sort: SortConfig<CoverageRow> = useMemo(
    () => ({
      columns: {
        level2: { value: (r) => r.level2_category.toLowerCase() },
        segment: { value: (r) => r.price_segment },
        creators: { value: (r) => r.creator_count, firstDir: "desc" },
        available: { value: (r) => r.total_slots_available, firstDir: "desc" },
        gmv: { value: (r) => r.total_proven_gmv, firstDir: "desc" },
        status: { value: (r) => r.status },
      },
      initial: { key: "available", dir: "desc" },
    }),
    []
  );

  const controls = useTableControls({
    rows,
    searchText: (r) => r.level2_category,
    sort,
    pageSizes: PAGE_SIZES_10_20_50_100,
    itemLabel: "kombinasi",
  });

  return (
    <div>
      <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
        <strong>Keterbatasan:</strong> tab ini hanya menampilkan kombinasi kategori × segmen yang{" "}
        <strong>sudah punya kreator</strong>. Kategori yang MEA punya NOL kreator — justru sinyal
        paling berguna untuk AM ("jangan tawarkan agency plan di sini") — tidak muncul sebagai baris
        "kosong"; ia tidak muncul sama sekali. Menutup celah ini butuh tabel master kategori resmi
        dari Hans (di luar lingkup PX-M1 — dicatat sebagai tiket lanjutan).
      </p>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <TableFilterBar controls={controls} searchPlaceholder="Cari kategori…" />
        <DownloadCoverageCsvButton />
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <SortableTh controls={controls} sortKey="level2" className={th}>Kategori</SortableTh>
              <SortableTh controls={controls} sortKey="segment" className={th}>Segmen Harga</SortableTh>
              <SortableTh controls={controls} sortKey="creators" className={th}>Jumlah Kreator</SortableTh>
              <SortableTh controls={controls} sortKey="available" className={th}>Total Slot Tersedia</SortableTh>
              <SortableTh controls={controls} sortKey="gmv" className={th}>Total Proven GMV</SortableTh>
              <SortableTh controls={controls} sortKey="status" className={th}>Status</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => (
              <tr key={`${r.level2_category}|${r.price_segment}`}>
                <td className={td}>{r.level2_category}</td>
                <td className={td}>{PRICE_SEGMENT_LABEL[r.price_segment] ?? r.price_segment}</td>
                <td className={`${td} text-right tabular-nums`}>{r.creator_count}</td>
                <td className={`${td} text-right tabular-nums font-medium`}>{r.total_slots_available}</td>
                <td className={`${td} text-right tabular-nums`}>{rpShort(r.total_proven_gmv)}</td>
                <td className={td}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.status === "covered" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {r.status === "covered" ? "Covered" : "Kosong"}
                  </span>
                </td>
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">
                  Belum ada data coverage.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination controls={controls} />
      </div>
    </div>
  );
}

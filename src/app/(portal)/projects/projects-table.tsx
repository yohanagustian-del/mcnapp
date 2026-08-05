"use client";

import Link from "next/link";
import { useMemo } from "react";
import { rupiah } from "@/lib/utils/format";
import {
  PAGE_SIZE_10, SortableTh, TableFilterBar, TablePagination, useTableControls,
  type FacetDef, type SortConfig,
} from "@/components/table-controls";

const STATUS_STYLES: Record<string, string> = {
  planning: "bg-slate-100 text-slate-600",
  aktif: "bg-green-100 text-green-800",
  selesai: "bg-blue-100 text-blue-800",
};

/** Satu baris Special Project (M7) — sudah diagregasi server, tabel tidak menghitung ulang. */
export interface ProjectRow {
  id: number;
  name: string;
  type: string | null;
  startDate: string | null;
  endDate: string | null;
  targetGmv: number | null;
  adsBudgetCap: number | null;
  targetCreators: number | null;
  /** Peserta yang sudah ter-bind (dari project_participants). */
  participants: number;
  status: string;
  /** Fraksi pencapaian dari result_summary (0.85 = 85%), null bila belum ada. */
  achievementPct: number | null;
}

/** Search mencakup nama DAN tipe project (showcase / bootcamp / China trip / …). */
const searchNameOrType = (p: ProjectRow) => `${p.name} ${p.type ?? ""}`;

/** Filter status: opsi diturunkan dari baris yang ada, jadi tidak menawarkan status kosong. */
const STATUS_FACET: FacetDef<ProjectRow>[] = [
  {
    key: "status",
    label: "Status",
    value: (p) => (p.status ? { value: p.status, label: p.status } : null),
    emptyLabel: "Belum ada status pada data ini.",
  },
];

/** Kolom yang bisa diurutkan lewat klik header. Kolom angka mulai dari besar → kecil. */
const SORT: SortConfig<ProjectRow> = {
  columns: {
    project: { value: (p) => p.name },
    periode: { value: (p) => p.startDate, firstDir: "desc" },
    targetGmv: { value: (p) => p.targetGmv, firstDir: "desc" },
    // Diurutkan dari kekurangan peserta terbesar, bukan jumlah absolutnya: yang
    // paling jauh dari target harus muncul lebih dulu.
    targetCreators: {
      value: (p) => (p.targetCreators == null ? null : p.targetCreators - p.participants),
      firstDir: "desc",
    },
    adsCap: { value: (p) => p.adsBudgetCap, firstDir: "desc" },
    status: { value: (p) => p.status },
    achievement: { value: (p) => p.achievementPct, firstDir: "desc" },
  },
  // Default = urutan yang dipakai server (project terbaru dulu).
  initial: { key: "periode", dir: "desc" },
};

/**
 * Tabel Special Project: search nama/tipe project, filter status (multi-select),
 * sort asc/desc di setiap header kolom, dan paginasi 10 baris per halaman.
 *
 * Semua client-side atas daftar yang sudah dimuat server component (limit 100) —
 * mengetik/menyortir/pindah halaman tidak memicu query Supabase baru.
 */
export function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  const facets = useMemo(() => STATUS_FACET, []);
  const controls = useTableControls<ProjectRow>({
    rows,
    searchText: searchNameOrType,
    facets,
    sort: SORT,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "project",
  });

  return (
    <>
      <TableFilterBar
        controls={controls}
        searchPlaceholder="Cari nama / tipe project…"
        className="mt-6"
      />

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="project">Project</SortableTh>
                <SortableTh controls={controls} sortKey="periode">Periode</SortableTh>
                <SortableTh controls={controls} sortKey="targetGmv">Target GMV</SortableTh>
                <SortableTh controls={controls} sortKey="targetCreators">Target Creator</SortableTh>
                <SortableTh controls={controls} sortKey="adsCap">Ads Cap</SortableTh>
                <SortableTh controls={controls} sortKey="status">Status</SortableTh>
                <SortableTh controls={controls} sortKey="achievement">Achievement</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/projects/${p.id}`} className="text-slate-900 underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                    {p.type && <span className="ml-1 text-xs text-slate-400">{p.type}</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{p.startDate ?? "—"} → {p.endDate ?? "—"}</td>
                  <td className="px-4 py-2">{rupiah(p.targetGmv)}</td>
                  <td className="px-4 py-2">
                    {p.targetCreators ? (
                      <span className={p.participants < p.targetCreators ? "text-amber-700" : "text-green-700"}>
                        {p.participants} / {p.targetCreators}
                      </span>
                    ) : (
                      `${p.participants}`
                    )}
                  </td>
                  <td className="px-4 py-2">{rupiah(p.adsBudgetCap)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {p.achievementPct !== null ? `${(p.achievementPct * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada project yang cocok dengan pencarian nama/tipe atau filter status."
                      : "Belum ada project."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination controls={controls} />
      </div>
    </>
  );
}

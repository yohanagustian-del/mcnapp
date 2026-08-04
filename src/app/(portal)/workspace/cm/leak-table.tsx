"use client";

import { rupiah, pct1 } from "@/lib/utils/format";
import {
  SortableTh, TableFilterBar, TablePagination, useTableControls, type SortConfig,
} from "@/components/table-controls";
import { CreatorLeakDetailButton } from "../../link-leakage/creator-leak-detail-button";

/** 4-status link leakage badge colours (CLAUDE.md link_status enum). */
const LEAK_STATUS_STYLES: Record<string, string> = {
  via_agency: "bg-green-100 text-green-800",
  bocor_sebagian: "bg-amber-100 text-amber-800",
  bocor_total: "bg-red-100 text-red-700",
  belum_ada_link: "bg-slate-100 text-slate-600",
};
const LEAK_STATUS_LABELS: Record<string, string> = {
  via_agency: "Via Agency",
  bocor_sebagian: "Bocor Sebagian",
  bocor_total: "Bocor Total",
  belum_ada_link: "Belum Ada Link",
};
/**
 * Urutan keparahan untuk sort kolom Status — bukan abjad: descending harus berarti
 * "paling bocor di atas", yang tidak sama dengan urutan huruf nama statusnya.
 */
const LEAK_STATUS_RANK: Record<string, number> = {
  via_agency: 0,
  belum_ada_link: 1,
  bocor_sebagian: 2,
  bocor_total: 3,
};

/** Satu baris rollup link leakage (minggu terbaru per kreator) — read-only, CLAUDE.md #3. */
export interface LeakTableRow {
  creatorId: string;
  creatorName: string;
  username: string | null;
  ownerCpmId: string | null;
  cmName: string | null;
  week: string;
  linkStatus: string | null;
  gmvBocor: number | null;
  leakRatio: number | null;
  /** gmv_tap / gmv_affiliate_total (fraksi), null kalau salah satu tidak ada. */
  effectiveness: number | null;
  source: string | null;
}

const searchUsername = (r: LeakTableRow) => r.username;
const rowCm = (r: LeakTableRow) => ({ id: r.ownerCpmId, name: r.cmName });

/** Kolom yang bisa diurutkan lewat klik header. Kolom angka mulai dari besar → kecil. */
const SORT: SortConfig<LeakTableRow> = {
  columns: {
    creator: { value: (r) => r.creatorName },
    cm: { value: (r) => r.cmName },
    week: { value: (r) => r.week, firstDir: "desc" },
    status: { value: (r) => (r.linkStatus ? LEAK_STATUS_RANK[r.linkStatus] ?? null : null), firstDir: "desc" },
    gmvBocor: { value: (r) => r.gmvBocor, firstDir: "desc" },
    leakRatio: { value: (r) => r.leakRatio, firstDir: "desc" },
    effectiveness: { value: (r) => r.effectiveness, firstDir: "desc" },
  },
  // Default = urutan yang dipakai server (GMV bocor terbesar dulu).
  initial: { key: "gmvBocor", dir: "desc" },
};

/**
 * Link Leakage Kreator (per minggu): search username, filter CM, sort asc/desc di
 * setiap header kolom, paginasi 10/20/50, dan tombol Detail per baris untuk mengunduh
 * detail produk bocor kreator itu (CSV).
 */
export function LeakTable({ rows }: { rows: LeakTableRow[] }) {
  const controls = useTableControls<LeakTableRow>({
    rows,
    searchText: searchUsername,
    cm: rowCm,
    sort: SORT,
    itemLabel: "kreator",
  });

  return (
    <>
      <TableFilterBar controls={controls} className="mt-3" />

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="creator">Kreator</SortableTh>
                <SortableTh controls={controls} sortKey="cm">CM</SortableTh>
                <SortableTh controls={controls} sortKey="week">Minggu</SortableTh>
                <SortableTh controls={controls} sortKey="status">Status</SortableTh>
                <SortableTh controls={controls} sortKey="gmvBocor">GMV Bocor</SortableTh>
                <SortableTh controls={controls} sortKey="leakRatio">Leak Ratio</SortableTh>
                <SortableTh controls={controls} sortKey="effectiveness">Efektivitas Link</SortableTh>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((r) => (
                <tr key={r.creatorId}>
                  <td className="px-4 py-2 font-medium">
                    {r.creatorName}{" "}
                    {r.username && <span className="text-xs text-slate-500">@{r.username}</span>}{" "}
                    <span className="text-xs text-slate-400">{r.creatorId}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{r.cmName ?? "—"}</td>
                  <td className="px-4 py-2">
                    {r.week}
                    {r.source === "artifact" && (
                      <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] text-indigo-700">artifak</span>
                    )}
                    {r.source === "platform" && (
                      <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">platform</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.linkStatus === null ? (
                      <span
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                        title="Status tidak tersedia dari artifak format ringkas (v2)"
                      >
                        —
                      </span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEAK_STATUS_STYLES[r.linkStatus] ?? ""}`}>
                        {LEAK_STATUS_LABELS[r.linkStatus] ?? r.linkStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{rupiah(r.gmvBocor)}</td>
                  <td className="px-4 py-2">{pct1(r.leakRatio)}</td>
                  <td className="px-4 py-2">{pct1(r.effectiveness)}</td>
                  <td className="px-4 py-2">
                    <CreatorLeakDetailButton creatorId={r.creatorId} week={r.week} />
                  </td>
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada kreator yang cocok dengan pencarian username / filter CM."
                      : "Belum ada data link leakage untuk creator di scope ini."}
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

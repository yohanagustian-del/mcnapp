"use client";

import { rupiah, pct1 } from "@/lib/utils/format";
import { TableFilterBar, TablePagination, useTableControls } from "@/components/table-controls";

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

/** Link Leakage Kreator (per minggu): search username, filter CM, paginasi 10/20/50. */
export function LeakTable({ rows }: { rows: LeakTableRow[] }) {
  const controls = useTableControls<LeakTableRow>({
    rows,
    searchText: searchUsername,
    cm: rowCm,
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
                <th className="px-4 py-3">Kreator</th>
                <th className="px-4 py-3">CM</th>
                <th className="px-4 py-3">Minggu</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">GMV Bocor</th>
                <th className="px-4 py-3">Leak Ratio</th>
                <th className="px-4 py-3">Efektivitas Link</th>
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
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
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

"use client";

import { rupiah, pct } from "@/lib/utils/format";
import { TableFilterBar, TablePagination, useTableControls } from "@/components/table-controls";
import { assignCreator } from "./actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/** Satu baris tabel Creator & Growth Mingguan (growth sudah dihitung server — CLAUDE.md #4). */
export interface CreatorGrowthRow {
  creatorId: string;
  name: string;
  username: string | null;
  ownerCpmId: string | null;
  cmName: string | null;
  level: number | null;
  segment: string | null;
  /** GMV periode terakhir; null = belum ada periode. */
  current: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** % vs periode sebelumnya; null = tidak bisa dibandingkan. */
  delta: number | null;
}

export interface PerfAlert {
  id: number | string;
  message: string;
}

export interface CpmOption {
  id: string;
  name: string;
}

// Search "berdasarkan kreator": cocokkan nama ATAU username, biar CM bisa pakai keduanya.
const searchCreator = (r: CreatorGrowthRow) => `${r.name} ${r.username ?? ""}`;
const rowCm = (r: CreatorGrowthRow) => ({ id: r.ownerCpmId, name: r.cmName });

/**
 * Creator & Growth Mingguan: alert performa sebagai card yang bisa di-minimize
 * (default terbuka supaya alert tetap terlihat), lalu tabel dengan search kreator,
 * filter CM, dan paginasi 10/20/50. Read-only kecuali re-assign CPM (server action).
 */
export function CreatorGrowthPanel({
  rows,
  alerts,
  cpms,
  canAssign,
}: {
  rows: CreatorGrowthRow[];
  alerts: PerfAlert[];
  cpms: CpmOption[];
  canAssign: boolean;
}) {
  const controls = useTableControls<CreatorGrowthRow>({
    rows,
    searchText: searchCreator,
    cm: rowCm,
    itemLabel: "kreator",
  });

  return (
    <>
      {alerts.length > 0 && (
        <details open className="mt-3 rounded-lg border border-red-200 bg-red-50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-red-800">
            ⚠ Alert performa ({alerts.length}) — klik untuk sembunyikan / tampilkan
          </summary>
          <div className="space-y-1 border-t border-red-200 px-3 py-2 text-sm text-red-800">
            {alerts.map((a) => (
              <p key={a.id}>⚠ {a.message}</p>
            ))}
          </div>
        </details>
      )}

      <TableFilterBar controls={controls} searchPlaceholder="Cari kreator (nama / username)…" className="mt-3" />

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Creator</th>
                <th className="px-4 py-3">CM</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Segmen</th>
                <th className="px-4 py-3">GMV periode terakhir</th>
                <th className="px-4 py-3">vs periode lalu</th>
                {canAssign && <th className="px-4 py-3">Re-assign CPM</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((c) => (
                <tr key={c.creatorId}>
                  <td className="px-4 py-2 font-medium">
                    {c.name}{" "}
                    {c.username && <span className="text-xs text-slate-500">@{c.username}</span>}{" "}
                    <span className="text-xs text-slate-400">{c.creatorId}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{c.cmName ?? "—"}</td>
                  <td className="px-4 py-2">
                    {c.level ? `L${c.level}` : "—"}{" "}
                    {c.level && c.level < 6 && <span className="text-xs text-slate-400">→ L{c.level + 1}</span>}
                  </td>
                  <td className="px-4 py-2">{c.segment ?? "—"}</td>
                  <td className="px-4 py-2">
                    {c.current !== null ? `${rupiah(c.current)} (${c.periodStart}–${c.periodEnd})` : "—"}
                  </td>
                  <td className={`px-4 py-2 ${c.delta !== null && c.delta < 0 ? "text-red-600" : "text-green-700"}`}>
                    {pct(c.delta)}
                  </td>
                  {canAssign && (
                    <td className="px-4 py-2">
                      <form action={assignCreator} className="flex items-center gap-1">
                        <input type="hidden" name="creator_id" value={c.creatorId} />
                        <select
                          name="owner_cpm_id"
                          defaultValue={c.ownerCpmId ?? ""}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="">— pilih CPM —</option>
                          {cpms.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <button type="submit" className={`${btnSmall} bg-slate-200 text-slate-700 hover:bg-slate-300`}>
                          Assign
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={canAssign ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada kreator yang cocok dengan pencarian / filter CM."
                      : "Belum ada creator di scope ini."}
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

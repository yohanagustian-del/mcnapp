"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toggleRosterAction } from "./actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";
const PAGE_SIZES = [10, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

export interface RosterRow {
  id: string;
  name: string;
  username: string | null;
  owner_cpm_id: string | null;
  cmName: string | null;
  jenis_creator: string | null;
  live_roster: boolean;
}

/**
 * Kelola roster — lists EVERY creator (from the master creators tab) and toggles whether
 * each appears in the M13 live-schedule calendar. Has its own controls (independent of the
 * calendar filter above): realtime search by username, CM multi-select filter, and
 * pagination with 10/50/100 rows per page. All client-side — the full list is loaded once.
 */
export function RosterPanel({ rows }: { rows: RosterRow[] }) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedCmIds, setSelectedCmIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  // CM filter options — distinct owners present in the list (never offers an empty CM).
  const cmOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of rows) if (r.owner_cpm_id) byId.set(r.owner_cpm_id, r.cmName ?? "—");
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [rows]);

  const filterActive = search.trim() !== "" || selectedCmIds.length > 0;

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const selected = new Set(selectedCmIds);
    return rows.filter((r) => {
      if (term && !(r.username ?? "").toLowerCase().includes(term)) return false;
      if (selected.size > 0 && (!r.owner_cpm_id || !selected.has(r.owner_cpm_id))) return false;
      return true;
    });
  }, [rows, search, selectedCmIds]);

  const total = filteredRows.length;
  const activeCount = useMemo(() => filteredRows.filter((r) => r.live_roster).length, [filteredRows]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Narrowing the filter can push the active page past the end — pull it back.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(total / pageSize))));
  }, [total, pageSize]);
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const visibleRows = useMemo(
    () => filteredRows.slice(start, start + pageSize),
    [filteredRows, start, pageSize]
  );

  function toggleCm(id: string) {
    setSelectedCmIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPage(1);
  }

  function resetFilters() {
    setSearch("");
    setSelectedCmIds([]);
    setPage(1);
  }

  function toggle(creatorId: string, nextOn: boolean) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("creator_id", creatorId);
      fd.set("on", nextOn ? "true" : "false");
      await toggleRosterAction(fd);
    });
  }

  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">
        Kelola Roster ({activeCount} aktif dari {total} kreator{filterActive ? " (terfilter)" : ""})
      </summary>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Cari username kreator…"
          aria-label="Cari username kreator"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            CM {selectedCmIds.length > 0 ? `(${selectedCmIds.length} terpilih)` : "(semua)"} ▾
          </summary>
          <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
            {cmOptions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-slate-400">Belum ada CM pada data kreator.</p>
            ) : (
              cmOptions.map((cm) => (
                <label
                  key={cm.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedCmIds.includes(cm.id)}
                    onChange={() => toggleCm(cm.id)}
                  />
                  <span className="truncate">{cm.name}</span>
                </label>
              ))
            )}
          </div>
        </details>

        {filterActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-md px-2 py-1 text-sm text-slate-500 underline underline-offset-2 hover:text-slate-800"
          >
            Reset filter
          </button>
        )}
      </div>

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Nama</th>
              <th className="px-4 py-2">Username</th>
              <th className="px-4 py-2">CM</th>
              <th className="px-4 py-2">Jenis</th>
              <th className="px-4 py-2">Roster Live</th>
              <th className="px-4 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2 text-slate-500">{r.username ? `@${r.username}` : "—"}</td>
                <td className="px-4 py-2 text-slate-500">{r.cmName ?? "—"}</td>
                <td className="px-4 py-2 text-slate-500">{r.jenis_creator ?? "—"}</td>
                <td className="px-4 py-2">
                  {r.live_roster ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Masuk</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Keluar</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(r.id, !r.live_roster)}
                    className={`${btnSmall} ${r.live_roster ? "bg-slate-200 text-slate-700 hover:bg-slate-300" : "bg-slate-900 text-white hover:bg-slate-700"} disabled:opacity-50`}
                  >
                    {r.live_roster ? "Keluarkan" : "Masuk roster"}
                  </button>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-5 text-center text-slate-400">
                  {filterActive
                    ? "Tidak ada kreator yang cocok dengan pencarian / filter CM."
                    : "Belum ada kreator."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2 text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          Baris per halaman
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Baris per halaman"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3">
          <span className="text-slate-500">
            {total === 0 ? "0 kreator" : `${start + 1}–${Math.min(start + pageSize, total)} dari ${total} kreator`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              ‹ Sebelumnya
            </button>
            <span className="px-2 text-slate-600">
              Hal. {safePage} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={safePage >= pageCount}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Berikutnya ›
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

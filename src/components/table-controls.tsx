"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface CmFilterOption {
  id: string;
  name: string;
}

/** Ukuran halaman standar untuk tabel padat di workspace. */
export const PAGE_SIZES_10_20_50 = [10, 20, 50] as const;
/** Tabel yang cuma butuh "10 tampilan" (tanpa pemilih ukuran). */
export const PAGE_SIZE_10 = [10] as const;

interface UseTableControlsArgs<T> {
  rows: T[];
  /**
   * Teks yang dicocokkan search box (username / nama kreator). Kalau tidak diisi,
   * search box tidak dirender dan tidak pernah mempersempit daftar.
   */
  searchText?: (row: T) => string | null | undefined;
  /**
   * CM pemilik baris (owner_cpm_id + nama tampilan) untuk multi-select CM. Kalau tidak
   * diisi, filter CM tidak dirender. Opsi dropdown diturunkan dari baris yang ada, jadi
   * tidak pernah menawarkan CM tanpa baris.
   */
  cm?: (row: T) => { id: string | null; name: string | null };
  pageSizes?: readonly number[];
  /** Kata benda di footer, mis. "kreator" / "baris" / "req". */
  itemLabel?: string;
}

export interface TableControls<T> {
  /** Baris pada halaman aktif (sudah terfilter + terpaginasi). */
  visibleRows: T[];
  /** Seluruh baris yang lolos filter (untuk baris TOTAL / ringkasan). */
  filteredRows: T[];
  total: number;
  start: number;
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizes: readonly number[];
  setPageSize: (n: number) => void;
  prevPage: () => void;
  nextPage: () => void;
  search: string;
  setSearch: (value: string) => void;
  hasSearch: boolean;
  cmOptions: CmFilterOption[];
  selectedCmIds: string[];
  toggleCm: (id: string) => void;
  hasCmFilter: boolean;
  filterActive: boolean;
  reset: () => void;
  itemLabel: string;
}

/**
 * Search (realtime) + filter CM (multi-select) + paginasi, semua client-side: daftar
 * penuh sudah dimuat server component, jadi mengetik tidak memicu query Supabase baru.
 * Dipakai section-section CM Workspace, panel kebutuhan project, dan jadwal live compact.
 */
export function useTableControls<T>({
  rows,
  searchText,
  cm,
  pageSizes = PAGE_SIZES_10_20_50,
  itemLabel = "baris",
}: UseTableControlsArgs<T>): TableControls<T> {
  const [search, setSearchRaw] = useState("");
  const [selectedCmIds, setSelectedCmIds] = useState<string[]>([]);
  const [pageSize, setPageSizeRaw] = useState<number>(pageSizes[0] ?? 10);
  const [page, setPage] = useState(1);

  const hasSearch = Boolean(searchText);
  const hasCmFilter = Boolean(cm);

  const cmOptions = useMemo<CmFilterOption[]>(() => {
    if (!cm) return [];
    const byId = new Map<string, string>();
    for (const row of rows) {
      const { id, name } = cm(row);
      if (id) byId.set(id, name ?? "—");
    }
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [rows, cm]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const selected = new Set(selectedCmIds);
    if (!term && selected.size === 0) return rows;
    return rows.filter((row) => {
      if (term && searchText && !(searchText(row) ?? "").toLowerCase().includes(term)) return false;
      if (selected.size > 0 && cm) {
        const { id } = cm(row);
        if (!id || !selected.has(id)) return false;
      }
      return true;
    });
  }, [rows, search, selectedCmIds, searchText, cm]);

  const total = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Menyempitkan filter bisa membuat halaman aktif melewati akhir daftar —
  // tarik kembali ke halaman terakhir yang masih ada.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(total / pageSize))));
  }, [total, pageSize]);

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const visibleRows = useMemo(
    () => filteredRows.slice(start, start + pageSize),
    [filteredRows, start, pageSize]
  );

  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    setPage(1);
  }, []);
  const setPageSize = useCallback((n: number) => {
    setPageSizeRaw(n);
    setPage(1);
  }, []);
  const toggleCm = useCallback((id: string) => {
    setSelectedCmIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPage(1);
  }, []);
  const reset = useCallback(() => {
    setSearchRaw("");
    setSelectedCmIds([]);
    setPage(1);
  }, []);

  return {
    visibleRows,
    filteredRows,
    total,
    start,
    page: safePage,
    pageCount,
    pageSize,
    pageSizes,
    setPageSize,
    prevPage: useCallback(() => setPage((p) => Math.max(1, p - 1)), []),
    nextPage: useCallback(() => setPage((p) => Math.min(pageCount, p + 1)), [pageCount]),
    search,
    setSearch,
    hasSearch,
    cmOptions,
    selectedCmIds,
    toggleCm,
    hasCmFilter,
    filterActive: search.trim() !== "" || selectedCmIds.length > 0,
    reset,
    itemLabel,
  };
}

/** Search box + dropdown filter CM + reset. Tidak merender apa pun kalau keduanya off. */
export function TableFilterBar<T>({
  controls,
  searchPlaceholder = "Cari username kreator…",
  className = "",
}: {
  controls: TableControls<T>;
  searchPlaceholder?: string;
  className?: string;
}) {
  const { hasSearch, hasCmFilter, search, setSearch, cmOptions, selectedCmIds, toggleCm, filterActive, reset } =
    controls;
  if (!hasSearch && !hasCmFilter) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {hasSearch && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      )}

      {hasCmFilter && (
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            CM {selectedCmIds.length > 0 ? `(${selectedCmIds.length} terpilih)` : "(semua)"} ▾
          </summary>
          <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
            {cmOptions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-slate-400">Belum ada CM pada data ini.</p>
            ) : (
              cmOptions.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedCmIds.includes(option.id)}
                    onChange={() => toggleCm(option.id)}
                  />
                  <span className="truncate">{option.name}</span>
                </label>
              ))
            )}
          </div>
        </details>
      )}

      {filterActive && (
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-sm text-slate-500 underline underline-offset-2 hover:text-slate-800"
        >
          Reset filter
        </button>
      )}
    </div>
  );
}

/** Footer paginasi: pemilih baris/halaman (disembunyikan kalau hanya 1 opsi) + prev/next. */
export function TablePagination<T>({ controls }: { controls: TableControls<T> }) {
  const { pageSize, pageSizes, setPageSize, total, start, page, pageCount, prevPage, nextPage, itemLabel } =
    controls;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-sm">
      {pageSizes.length > 1 ? (
        <label className="flex items-center gap-2 text-slate-600">
          Baris per halaman
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="Baris per halaman"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      ) : (
        <span className="text-slate-500">{pageSize} per halaman</span>
      )}

      <div className="flex items-center gap-3">
        <span className="text-slate-500">
          {total === 0
            ? `0 ${itemLabel}`
            : `${start + 1}–${Math.min(start + pageSize, total)} dari ${total} ${itemLabel}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevPage}
            disabled={page <= 1}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            ‹ Sebelumnya
          </button>
          <span className="px-2 text-slate-600">
            Hal. {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={nextPage}
            disabled={page >= pageCount}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Berikutnya ›
          </button>
        </div>
      </div>
    </div>
  );
}

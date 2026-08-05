"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nextSortState, sortRows, type SortDir, type SortValue } from "@/lib/utils/table-sort";

export interface CmFilterOption {
  id: string;
  name: string;
}

/** Satu opsi pada dropdown filter generik (facet): nilai yang dicocokkan + label tampil. */
export interface FacetOption {
  value: string;
  label: string;
}

/**
 * Filter generik multi-select (brand, tanggal, jam, …) di luar filter CM bawaan.
 * `value(row)` mengembalikan nilai facet baris, atau null kalau baris tidak punya
 * nilai — baris tanpa nilai tidak menyumbang opsi dan ikut tersaring saat facet
 * itu aktif (sama seperti perilaku filter CM).
 */
export interface FacetDef<T> {
  /** Kunci unik (state + key React), mis. "brand". */
  key: string;
  /** Label tombol dropdown, mis. "Brand". */
  label: string;
  value: (row: T) => FacetOption | null;
  /** Urutkan opsi berdasarkan `value` (mis. tanggal/jam) atau `label` (default). */
  sortBy?: "label" | "value";
  /** Teks saat data tidak punya nilai facet sama sekali. */
  emptyLabel?: string;
}

/** Facet siap render: opsi diturunkan dari baris + state terpilih. */
export interface FacetControl {
  key: string;
  label: string;
  options: FacetOption[];
  selected: string[];
  toggle: (value: string) => void;
  emptyLabel: string;
}

/** Definisi satu kolom yang bisa diurutkan lewat header tabel. */
export interface SortDef<T> {
  value: (row: T) => SortValue;
  /** Arah pertama saat kolom ini baru dipilih — kolom angka biasanya "desc". */
  firstDir?: SortDir;
}

export interface SortConfig<T> {
  /** key kolom → cara membaca nilainya. Key dipakai juga oleh <SortableTh>. */
  columns: Record<string, SortDef<T>>;
  /** Urutan awal saat tabel pertama dirender. */
  initial?: { key: string; dir: SortDir };
  /**
   * Klik ketiga pada kolom yang sama mengembalikan urutan ke `initial` (atau urutan
   * bawaan dari server kalau `initial` kosong) — naik → turun → bawaan. Dipakai tabel
   * yang urutan servernya bermakna (mis. Deal Brand: terbaru dulu).
   */
  resettable?: boolean;
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
  /**
   * Filter multi-select tambahan (brand / tanggal / jam / …). Opsi diturunkan dari
   * baris yang ada — sama seperti filter CM. Memo-kan array ini di pemanggil.
   */
  facets?: FacetDef<T>[];
  /** Kolom yang bisa diurutkan lewat header (asc/desc). Memo-kan di pemanggil. */
  sort?: SortConfig<T>;
  pageSizes?: readonly number[];
  /** Kata benda di footer, mis. "kreator" / "baris" / "req". */
  itemLabel?: string;
}

export interface TableControls<T> {
  /** Baris pada halaman aktif (sudah terfilter + terurut + terpaginasi). */
  visibleRows: T[];
  /** Seluruh baris yang lolos filter, sudah terurut (untuk baris TOTAL / ringkasan). */
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
  facets: FacetControl[];
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
  hasSort: boolean;
  filterActive: boolean;
  reset: () => void;
  itemLabel: string;
}

/**
 * Search (realtime) + filter CM (multi-select) + facet tambahan + sort header +
 * paginasi, semua client-side: daftar penuh sudah dimuat server component, jadi
 * mengetik/menyortir tidak memicu query Supabase baru. Dipakai section-section CM
 * Workspace, panel kebutuhan project, dan jadwal live compact.
 */
export function useTableControls<T>({
  rows,
  searchText,
  cm,
  facets: facetDefs,
  sort,
  pageSizes = PAGE_SIZES_10_20_50,
  itemLabel = "baris",
}: UseTableControlsArgs<T>): TableControls<T> {
  const [search, setSearchRaw] = useState("");
  const [selectedCmIds, setSelectedCmIds] = useState<string[]>([]);
  const [selectedFacets, setSelectedFacets] = useState<Record<string, string[]>>({});
  const [sortState, setSortState] = useState<{ key: string; dir: SortDir } | null>(sort?.initial ?? null);
  const [pageSize, setPageSizeRaw] = useState<number>(pageSizes[0] ?? 10);
  const [page, setPage] = useState(1);

  const hasSearch = Boolean(searchText);
  const hasCmFilter = Boolean(cm);
  const hasSort = Boolean(sort && Object.keys(sort.columns).length > 0);

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

  // Opsi tiap facet diturunkan dari baris yang ada — tidak pernah menawarkan nilai
  // yang tak punya baris (sama seperti filter CM di atas).
  const facetOptions = useMemo<Record<string, FacetOption[]>>(() => {
    const out: Record<string, FacetOption[]> = {};
    for (const def of facetDefs ?? []) {
      const byValue = new Map<string, string>();
      for (const row of rows) {
        const option = def.value(row);
        if (option) byValue.set(option.value, option.label);
      }
      out[def.key] = [...byValue]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) =>
          def.sortBy === "value"
            ? a.value.localeCompare(b.value, "id", { numeric: true })
            : a.label.localeCompare(b.label, "id", { numeric: true })
        );
    }
    return out;
  }, [rows, facetDefs]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const selectedCm = new Set(selectedCmIds);
    const activeFacets = (facetDefs ?? [])
      .map((def) => ({ def, selected: new Set(selectedFacets[def.key] ?? []) }))
      .filter((f) => f.selected.size > 0);

    if (!term && selectedCm.size === 0 && activeFacets.length === 0) return rows;
    return rows.filter((row) => {
      if (term && searchText && !(searchText(row) ?? "").toLowerCase().includes(term)) return false;
      if (selectedCm.size > 0 && cm) {
        const { id } = cm(row);
        if (!id || !selectedCm.has(id)) return false;
      }
      for (const { def, selected } of activeFacets) {
        const option = def.value(row);
        if (!option || !selected.has(option.value)) return false;
      }
      return true;
    });
  }, [rows, search, selectedCmIds, selectedFacets, searchText, cm, facetDefs]);

  const sortedRows = useMemo(() => {
    const column = sortState && sort ? sort.columns[sortState.key] : undefined;
    if (!column || !sortState) return filteredRows;
    return sortRows(filteredRows, column.value, sortState.dir);
  }, [filteredRows, sortState, sort]);

  const total = sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Menyempitkan filter bisa membuat halaman aktif melewati akhir daftar —
  // tarik kembali ke halaman terakhir yang masih ada.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(total / pageSize))));
  }, [total, pageSize]);

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const visibleRows = useMemo(
    () => sortedRows.slice(start, start + pageSize),
    [sortedRows, start, pageSize]
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
  const toggleFacet = useCallback((key: string, value: string) => {
    setSelectedFacets((prev) => {
      const current = prev[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [key]: next };
    });
    setPage(1);
  }, []);
  const toggleSort = useCallback(
    (key: string) => {
      const firstDir = sort?.columns[key]?.firstDir ?? "asc";
      setSortState((prev) =>
        nextSortState(prev, key, firstDir, {
          resettable: sort?.resettable,
          fallback: sort?.initial ?? null,
        })
      );
      setPage(1);
    },
    [sort]
  );
  const reset = useCallback(() => {
    setSearchRaw("");
    setSelectedCmIds([]);
    setSelectedFacets({});
    setPage(1);
  }, []);

  const facets = useMemo<FacetControl[]>(
    () =>
      (facetDefs ?? []).map((def) => ({
        key: def.key,
        label: def.label,
        options: facetOptions[def.key] ?? [],
        selected: selectedFacets[def.key] ?? [],
        toggle: (value: string) => toggleFacet(def.key, value),
        emptyLabel: def.emptyLabel ?? `Belum ada ${def.label.toLowerCase()} pada data ini.`,
      })),
    [facetDefs, facetOptions, selectedFacets, toggleFacet]
  );

  return {
    visibleRows,
    filteredRows: sortedRows,
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
    facets,
    sortKey: sortState?.key ?? null,
    sortDir: sortState?.dir ?? "asc",
    toggleSort,
    hasSort,
    filterActive:
      search.trim() !== "" ||
      selectedCmIds.length > 0 ||
      Object.values(selectedFacets).some((v) => v.length > 0),
    reset,
    itemLabel,
  };
}

/** Dropdown multi-select generik (dipakai filter CM dan semua facet). */
function MultiSelectFilter({
  label,
  options,
  selected,
  toggle,
  emptyLabel,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  toggle: (value: string) => void;
  emptyLabel: string;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
        {label} {selected.length > 0 ? `(${selected.length} terpilih)` : "(semua)"} ▾
      </summary>
      <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
        {options.length === 0 ? (
          <p className="px-2 py-1 text-xs text-slate-400">{emptyLabel}</p>
        ) : (
          options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))
        )}
      </div>
    </details>
  );
}

/** Search box + filter CM + facet tambahan + reset. Tidak merender apa pun kalau semua off. */
export function TableFilterBar<T>({
  controls,
  searchPlaceholder = "Cari username kreator…",
  className = "",
}: {
  controls: TableControls<T>;
  searchPlaceholder?: string;
  className?: string;
}) {
  const {
    hasSearch, hasCmFilter, search, setSearch, cmOptions, selectedCmIds, toggleCm,
    facets, filterActive, reset,
  } = controls;
  if (!hasSearch && !hasCmFilter && facets.length === 0) return null;

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
        <MultiSelectFilter
          label="CM"
          options={cmOptions.map((o) => ({ value: o.id, label: o.name }))}
          selected={selectedCmIds}
          toggle={toggleCm}
          emptyLabel="Belum ada CM pada data ini."
        />
      )}

      {facets.map((facet) => (
        <MultiSelectFilter
          key={facet.key}
          label={facet.label}
          options={facet.options}
          selected={facet.selected}
          toggle={facet.toggle}
          emptyLabel={facet.emptyLabel}
        />
      ))}

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

/**
 * Header kolom yang bisa diklik untuk mengurutkan (asc ⇄ desc). Klik pertama pada
 * kolom baru memakai `firstDir` dari SortConfig (kolom angka biasanya "desc"),
 * klik berikutnya membalik arah.
 */
export function SortableTh<T>({
  controls,
  sortKey,
  className = "px-4 py-3",
  children,
}: {
  controls: TableControls<T>;
  sortKey: string;
  /** Kelas <th> lengkap (termasuk padding) — tabel padat memakai px-3. */
  className?: string;
  children: React.ReactNode;
}) {
  const active = controls.sortKey === sortKey;
  const dir = active ? controls.sortDir : null;

  return (
    <th
      className={className}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => controls.toggleSort(sortKey)}
        className="inline-flex items-center gap-1 whitespace-nowrap uppercase hover:text-slate-800"
        title={`Urutkan berdasarkan kolom ini (${dir === "asc" ? "sekarang naik" : dir === "desc" ? "sekarang turun" : "belum diurutkan"})`}
      >
        {children}
        <span aria-hidden="true" className={active ? "text-slate-700" : "text-slate-300"}>
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
        </span>
      </button>
    </th>
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

export type { SortDir, SortValue };

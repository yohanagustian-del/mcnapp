"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface CmOption {
  id: string;
  name: string;
}

interface CreatorFilterValue {
  query: string;
  setQuery: (value: string) => void;
  cms: CmOption[];
  selectedCmIds: string[];
  toggleCm: (id: string) => void;
  clearCms: () => void;
  /** Distinct creator "jenis" values available to filter on (empty = filter hidden). */
  jenisOptions: string[];
  selectedJenis: string[];
  toggleJenis: (value: string) => void;
  clearJenis: () => void;
  reset: () => void;
  /** True when the name search, CM multi-select, or jenis multi-select narrows the list. */
  isActive: boolean;
  /** Creator passes when it matches the name search AND a selected CM AND a selected jenis. */
  matches: (name: string, ownerCpmId: string | null, jenisCreator?: string | null) => boolean;
}

const CreatorFilterContext = createContext<CreatorFilterValue | null>(null);

export function useCreatorFilter(): CreatorFilterValue {
  const value = useContext(CreatorFilterContext);
  if (!value) throw new Error("useCreatorFilter harus dipakai di dalam CreatorFilterProvider");
  return value;
}

/**
 * Client-side name search + CM multi-select shared by the schedule calendar, the
 * schedule roster panel and the creators master table. Each list is already fully
 * loaded by its server component, so the filtering is pure JS — no extra Supabase
 * round-trip per keystroke.
 *
 * `jenisOptions` is opt-in: callers that pass a non-empty list (the schedule page) get
 * an extra "Jenis Kreator" dropdown; callers that omit it (the creators master table)
 * behave exactly as before — the dropdown is hidden and jenis never narrows the list.
 */
export function CreatorFilterProvider({
  cms,
  jenisOptions = [],
  children,
}: {
  cms: CmOption[];
  jenisOptions?: string[];
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [selectedCmIds, setSelectedCmIds] = useState<string[]>([]);
  const [selectedJenis, setSelectedJenis] = useState<string[]>([]);

  const toggleCm = useCallback((id: string) => {
    setSelectedCmIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);
  const clearCms = useCallback(() => setSelectedCmIds([]), []);
  const toggleJenis = useCallback((value: string) => {
    setSelectedJenis((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
  }, []);
  const clearJenis = useCallback(() => setSelectedJenis([]), []);
  const reset = useCallback(() => {
    setQuery("");
    setSelectedCmIds([]);
    setSelectedJenis([]);
  }, []);

  const value = useMemo<CreatorFilterValue>(() => {
    const term = query.trim().toLowerCase();
    const selectedCms = new Set(selectedCmIds);
    const selectedJenisSet = new Set(selectedJenis);
    return {
      query,
      setQuery,
      cms,
      selectedCmIds,
      toggleCm,
      clearCms,
      jenisOptions,
      selectedJenis,
      toggleJenis,
      clearJenis,
      reset,
      isActive: term.length > 0 || selectedCms.size > 0 || selectedJenisSet.size > 0,
      matches: (name, ownerCpmId, jenisCreator) => {
        if (term && !name.toLowerCase().includes(term)) return false;
        if (selectedCms.size > 0 && (!ownerCpmId || !selectedCms.has(ownerCpmId))) return false;
        if (selectedJenisSet.size > 0 && (!jenisCreator || !selectedJenisSet.has(jenisCreator))) return false;
        return true;
      },
    };
  }, [query, selectedCmIds, selectedJenis, cms, jenisOptions, toggleCm, clearCms, toggleJenis, clearJenis, reset]);

  return <CreatorFilterContext.Provider value={value}>{children}</CreatorFilterContext.Provider>;
}

/** Search bar (nama kreator, real-time) + filter multi-select CM (+ Jenis Kreator) + reset. */
export function CreatorFilterBar() {
  const {
    query,
    setQuery,
    cms,
    selectedCmIds,
    toggleCm,
    clearCms,
    jenisOptions,
    selectedJenis,
    toggleJenis,
    clearJenis,
    reset,
    isActive,
  } = useCreatorFilter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cari nama kreator…"
        aria-label="Cari nama kreator"
        className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
      />

      <details className="relative">
        <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          CM {selectedCmIds.length > 0 ? `(${selectedCmIds.length} terpilih)` : "(semua)"} ▾
        </summary>
        <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          {cms.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-400">Belum ada CM pada data kreator.</p>
          ) : (
            cms.map((cm) => (
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
          {selectedCmIds.length > 0 && (
            <button
              type="button"
              onClick={clearCms}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-slate-500 underline hover:bg-slate-50"
            >
              Bersihkan pilihan CM
            </button>
          )}
        </div>
      </details>

      {jenisOptions.length > 0 && (
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Jenis Kreator {selectedJenis.length > 0 ? `(${selectedJenis.length} terpilih)` : "(semua)"} ▾
          </summary>
          <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
            {jenisOptions.map((jenis) => (
              <label
                key={jenis}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedJenis.includes(jenis)}
                  onChange={() => toggleJenis(jenis)}
                />
                <span className="truncate">{jenis}</span>
              </label>
            ))}
            {selectedJenis.length > 0 && (
              <button
                type="button"
                onClick={clearJenis}
                className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-slate-500 underline hover:bg-slate-50"
              >
                Bersihkan pilihan jenis
              </button>
            )}
          </div>
        </details>
      )}

      {isActive && (
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

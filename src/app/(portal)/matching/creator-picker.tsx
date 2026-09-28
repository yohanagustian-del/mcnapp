"use client";

import { useMemo, useState } from "react";

export interface CreatorOption {
  id: string;
  name: string;
}

/**
 * Ganti `<select>` polos daftar kreator (bisa ratusan baris) jadi kotak cari
 * ketik-untuk-filter — pola yang sama dengan ManpowerMemberPicker
 * (projects/[id]/manpower-member-picker.tsx). Tetap mengeset hidden input
 * `creator_id` supaya form induknya (action={runMatching}) tidak perlu berubah.
 */
export function CreatorPicker({ creators }: { creators: CreatorOption[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CreatorOption | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return creators;
    return creators.filter(
      (c) => c.name.toLowerCase().includes(term) || c.id.toLowerCase().includes(term)
    );
  }, [query, creators]);

  return (
    <div>
      <input type="hidden" name="creator_id" value={selected?.id ?? ""} required />
      {selected ? (
        <div className="flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">
          <span className="truncate">{selected.name} ({selected.id})</span>
          <button
            type="button"
            onClick={() => { setSelected(null); setQuery(""); }}
            className="ml-2 text-xs text-slate-400 hover:text-slate-600"
          >
            Ganti
          </button>
        </div>
      ) : (
        <div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ketik untuk cari kreator…"
            aria-label="Cari kreator"
            className="w-full min-w-[220px] rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
            {creators.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">Belum ada kreator.</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">Tidak ada yang cocok.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  {c.name} <span className="text-slate-400">({c.id})</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

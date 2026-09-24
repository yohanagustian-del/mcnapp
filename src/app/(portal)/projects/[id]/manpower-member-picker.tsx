"use client";

import { useMemo, useState } from "react";

export interface TeamMemberOption {
  id: string;
  name: string;
  role: string;
}

/**
 * Ganti `<select>` polos daftar anggota tim (bisa ratusan baris) jadi kotak cari
 * ketik-untuk-filter, pola yang sama dengan pemilih CM di AddCreatorForm
 * (schedule/add-creator-form.tsx). Tetap mengeset hidden input `member_id` supaya
 * form induknya (action={assignManpower}) tidak perlu berubah sama sekali.
 */
export function ManpowerMemberPicker({ members }: { members: TeamMemberOption[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<TeamMemberOption | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      (m) => m.name.toLowerCase().includes(term) || m.role.toLowerCase().includes(term)
    );
  }, [query, members]);

  return (
    <div>
      <input type="hidden" name="member_id" value={selected?.id ?? ""} required />
      {selected ? (
        <div className="flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">
          <span className="truncate">{selected.name} ({selected.role})</span>
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
            placeholder="Ketik untuk cari anggota tim…"
            aria-label="Cari anggota tim"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200">
            {members.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">Belum ada anggota tim.</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">Tidak ada yang cocok.</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelected(m)}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  {m.name} <span className="text-slate-400">({m.role})</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

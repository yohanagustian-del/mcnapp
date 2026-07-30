"use client";

import { useMemo, useState, useTransition } from "react";
import type { CmOption } from "@/components/creator-filter";
import { createCreatorAction } from "./actions";

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnGhost = "rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";

/**
 * "Tambah Kreator" button + modal-ish panel. Collects a CM (searchable realtime dropdown,
 * options sourced from the CM list already loaded by the schedule page — not hardcoded)
 * and a username, then creates the creator via createCreatorAction. On success the new
 * creator (live_roster=true) appears in the calendar and can be scheduled through the
 * existing "+ slot" flow. Follows the same server-action refresh pattern as SlotForm.
 */
export function AddCreatorButton({ cms }: { cms: CmOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn}>
        + Tambah Kreator
      </button>
      {open && <AddCreatorForm cms={cms} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddCreatorForm({ cms, onClose }: { cms: CmOption[]; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [cmQuery, setCmQuery] = useState("");
  const [selectedCm, setSelectedCm] = useState<CmOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filteredCms = useMemo(() => {
    const term = cmQuery.trim().toLowerCase();
    if (!term) return cms;
    return cms.filter((cm) => cm.name.toLowerCase().includes(term));
  }, [cmQuery, cms]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedCm) {
      setError("CM wajib dipilih.");
      return;
    }
    if (!username.trim()) {
      setError("Username kreator wajib diisi.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("owner_cpm_id", selectedCm.id);
      fd.set("username", username.trim());
      const res = await createCreatorAction(fd);
      if (res.ok) {
        onClose();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Tambah Kreator ke Roster Live</h3>
          <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">
            Tutup
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600">CM</label>
            {selectedCm ? (
              <div className="mt-1 flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">
                <span className="truncate">{selectedCm.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCm(null);
                    setCmQuery("");
                  }}
                  className="ml-2 text-xs text-slate-400 hover:text-slate-600"
                >
                  Ganti
                </button>
              </div>
            ) : (
              <div className="mt-1">
                <input
                  type="search"
                  value={cmQuery}
                  onChange={(e) => setCmQuery(e.target.value)}
                  placeholder="Ketik untuk cari CM…"
                  aria-label="Cari CM"
                  className={input}
                  autoFocus
                />
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200">
                  {cms.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">Belum ada CM pada sistem.</p>
                  ) : filteredCms.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">Tidak ada CM yang cocok.</p>
                  ) : (
                    filteredCms.map((cm) => (
                      <button
                        key={cm.id}
                        type="button"
                        onClick={() => setSelectedCm(cm)}
                        className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                      >
                        {cm.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Username Kreator</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="mis. namakreator"
              className={input}
            />
          </div>

          {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending} className={btn}>
              {pending ? "Menyimpan..." : "Simpan Kreator"}
            </button>
            <button type="button" onClick={onClose} className={btnGhost}>
              Batal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

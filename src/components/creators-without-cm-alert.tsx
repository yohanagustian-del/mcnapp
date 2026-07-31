"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { assignCmToCreators } from "@/app/(portal)/workspace/cm/actions";
import type { CmOption, CreatorWithoutCm } from "@/lib/creators/without-cm";

const PAGE_SIZE = 15;

const btnPrimary =
  "rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50";

interface Props {
  total: number;
  rows: CreatorWithoutCm[];
  cmOptions: CmOption[];
  /** m8.assign_creator — Director/Head/SPV/CM Lead. Others see the list read-only. */
  canAssign: boolean;
}

/**
 * Alert card "Kreator belum punya CM".
 *
 * Upload data platform mingguan membuat username yang belum ada di master
 * menjadi kreator baru TANPA CM (yang mengunggah belum tentu CM-nya). Kreator
 * tanpa CM tidak masuk scope CM Workspace maupun agregasi OKR, jadi backlog-nya
 * ditampilkan di sini — bukan didiamkan.
 *
 * Pilih beberapa kreator → pilih CM → Terapkan. Hanya mengisi CM yang kosong;
 * tidak pernah memindahkan kreator dari CM yang sudah ada.
 */
export function CreatorsWithoutCmAlert({ total, rows, cmOptions, canAssign }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cmId, setCmId] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || (r.username ?? "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  const visible = filtered.slice(0, shown);

  if (total === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allPicked = visible.every((r) => next.has(r.id));
      for (const r of visible) {
        if (allPicked) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  function onApply() {
    setError(null);
    setDone(null);
    const ids = [...selected];
    startTransition(async () => {
      try {
        const res = await assignCmToCreators(ids, cmId);
        const cmName = cmOptions.find((c) => c.id === cmId)?.name ?? "CM terpilih";
        setDone(
          `${res.assigned} kreator ditugaskan ke ${cmName}` +
            (res.skipped > 0 ? ` — ${res.skipped} dilewati (sudah punya CM).` : ".")
        );
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menyimpan CM");
      }
    });
  }

  const allVisiblePicked = visible.length > 0 && visible.every((r) => selected.has(r.id));

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-900">
          ⚠ {total.toLocaleString("id-ID")} kreator belum punya CM
        </h2>
        <Link href="/creators" className="text-xs text-amber-800 underline">
          Kelola di halaman Kreator
        </Link>
      </div>
      <p className="mt-1 text-xs text-amber-900">
        Kreator ini dibuat otomatis dari upload data platform mingguan — username-nya belum ada di
        master, jadi ditambahkan dengan <strong>CM dikosongkan</strong> (yang mengunggah belum tentu
        CM-nya). Selama CM kosong, kreator tidak muncul di CM Workspace dan tidak ikut agregasi OKR.
      </p>

      {!canAssign && (
        <p className="mt-3 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
          Role Anda tidak bisa menetapkan CM — hubungi CM Lead / Head untuk mengisi daftar di bawah.
        </p>
      )}

      {done && <p className="mt-3 rounded-md bg-green-50 p-2 text-sm text-green-800">{done}</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE_SIZE);
          }}
          placeholder="Cari username / nama…"
          className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
        />
        {canAssign && (
          <>
            <button type="button" onClick={selectAllVisible} className={btnSecondary} disabled={pending}>
              {allVisiblePicked ? "Batal pilih" : `Pilih ${visible.length} tampil`}
            </button>
            <select
              value={cmId}
              onChange={(e) => setCmId(e.target.value)}
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Pilih CM —</option>
              {cmOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.role})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onApply}
              disabled={pending || !cmId || selected.size === 0}
              className={btnPrimary}
            >
              {pending ? "Menyimpan…" : `Terapkan ke ${selected.size} terpilih`}
            </button>
          </>
        )}
      </div>

      {cmOptions.length === 0 && canAssign && (
        <p className="mt-2 text-xs text-red-700">
          Belum ada CPM/CM Lead aktif di tabel Tim — daftarkan dulu sebelum menetapkan CM.
        </p>
      )}

      <div className="mt-3 max-h-72 overflow-auto rounded-md border border-amber-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-amber-100 text-left text-xs uppercase text-amber-900">
            <tr>
              {canAssign && <th className="w-10 px-3 py-2" />}
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Platform</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {visible.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-amber-50" : undefined}>
                {canAssign && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Pilih ${r.username ?? r.name}`}
                    />
                  </td>
                )}
                <td className="px-3 py-2 font-medium text-slate-800">{r.username ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.name}</td>
                <td className="px-3 py-2 text-slate-500">{r.platform ?? "tiktok"}</td>
                <td className="px-3 py-2 text-slate-500">{r.status}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={canAssign ? 5 : 4} className="px-3 py-4 text-center text-slate-400">
                  Tidak ada kreator yang cocok dengan pencarian.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {shown < filtered.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE_SIZE)}
          className="mt-2 text-xs text-amber-800 underline"
        >
          Tampilkan {Math.min(PAGE_SIZE, filtered.length - shown)} lagi ({filtered.length - shown} tersisa)
        </button>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { inviteCreators, type ShortlistRow } from "./requirements-actions";

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Hasil Cari Kreator: pilih beberapa, Undang sekaligus (§3.4 langkah 2). */
export function ShortlistPanel({ projectId, rows }: { projectId: number; rows: ShortlistRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(creatorId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(creatorId)) next.delete(creatorId); else next.add(creatorId);
      return next;
    });
  }

  function onInvite() {
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.set("project_id", String(projectId));
    for (const id of selected) fd.append("creator_ids", id);
    startTransition(async () => {
      try {
        await inviteCreators(fd);
        setResult(`${selected.size} kreator diundang.`);
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengundang.");
      }
    });
  }

  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">Tidak ada kandidat yang cocok dengan kebutuhan saat ini.</p>;
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{rows.length} kandidat · {selected.size} dipilih</p>
        <button type="button" onClick={onInvite} disabled={pending || selected.size === 0}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {pending ? "Mengundang…" : `Undang (${selected.size})`}
        </button>
      </div>
      {result && <p className="mt-1 text-xs text-green-700">{result}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Kreator</th>
              <th className="px-3 py-2">Niche</th>
              <th className="px-3 py-2">Level</th>
              <th className="px-3 py-2">GMV 30 Hari</th>
              <th className="px-3 py-2">Live Share</th>
              <th className="px-3 py-2">Skor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.creatorId}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(r.creatorId)} onChange={() => toggle(r.creatorId)} />
                </td>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2">{r.niche ?? "—"}</td>
                <td className="px-3 py-2">{r.level ?? "—"}</td>
                <td className="px-3 py-2">{rupiah(r.gmv30d)}</td>
                <td className="px-3 py-2">{(r.liveShare * 100).toFixed(0)}%</td>
                <td className="px-3 py-2">{r.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

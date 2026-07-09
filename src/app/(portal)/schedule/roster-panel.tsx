"use client";

import { useTransition } from "react";
import { toggleRosterAction } from "./actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

export interface RosterRow {
  id: string;
  name: string;
  username: string | null;
  cmName: string | null;
  jenis_creator: string | null;
  live_roster: boolean;
}

/** Kelola roster — toggle whether a creator appears in the M13 live-schedule calendar. */
export function RosterPanel({ rows }: { rows: RosterRow[] }) {
  const [pending, startTransition] = useTransition();

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
        Kelola Roster ({rows.filter((r) => r.live_roster).length} aktif dari {rows.length} kreator)
      </summary>
      <div className="overflow-x-auto border-t border-slate-100">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Nama</th>
              <th className="px-4 py-2">Handle</th>
              <th className="px-4 py-2">CM</th>
              <th className="px-4 py-2">Jenis</th>
              <th className="px-4 py-2">Roster Live</th>
              <th className="px-4 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-5 text-center text-slate-400">
                  Belum ada kreator.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

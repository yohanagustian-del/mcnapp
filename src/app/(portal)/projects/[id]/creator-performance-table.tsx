"use client";

import { useState, useTransition } from "react";
import {
  PAGE_SIZES_10_50_100,
  SortableTh,
  TablePagination,
  useTableControls,
  type SortConfig,
} from "@/components/table-controls";
import { removeParticipant, updateParticipantTarget } from "../actions";

/**
 * Satu baris Performa per Kreator — angkanya sudah dijumlahkan di server dari
 * project_creator_metrics (GMV & item per peserta) dan dibandingkan dengan target
 * peserta + total GMV project. Komponen ini hanya urut + paginasi.
 */
export interface CreatorPerformanceRow {
  creatorId: string;
  creatorName: string;
  /** CM pemilik kreator (creators.owner_cpm_id) — dasar rollup Performa per CM. */
  cmId: string | null;
  cmName: string | null;
  targetGmv: number | null;
  gmv: number;
  items: number;
  /** GMV / target; null = peserta tanpa target. */
  pctTarget: number | null;
  /** GMV peserta / total GMV project. */
  contribution: number;
}

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

/** GMV aktual default turun: yang paling berkontribusi muncul lebih dulu. */
const SORT: SortConfig<CreatorPerformanceRow> = {
  columns: {
    creator: { value: (r) => r.creatorName },
    cm: { value: (r) => r.cmName },
    target: { value: (r) => r.targetGmv, firstDir: "desc" },
    gmv: { value: (r) => r.gmv, firstDir: "desc" },
    items: { value: (r) => r.items, firstDir: "desc" },
    pct: { value: (r) => r.pctTarget, firstDir: "desc" },
    kontribusi: { value: (r) => r.contribution, firstDir: "desc" },
  },
  initial: { key: "gmv", dir: "desc" },
};

/** Edit target GMV inline — form kecil, muncul saat baris di-klik "Edit". */
function EditTargetForm({
  projectId, creatorId, initialTarget, onDone,
}: {
  projectId: number; creatorId: string; initialTarget: number | null; onDone: () => void;
}) {
  const [value, setValue] = useState(initialTarget !== null ? String(Math.round(initialTarget)) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const formData = new FormData();
        formData.set("project_id", String(projectId));
        formData.set("creator_id", creatorId);
        formData.set("target_gmv", value);
        startTransition(async () => {
          const res = await updateParticipantTarget(formData);
          if (res.ok) onDone();
          else setError(res.error);
        });
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Target GMV (Rp)"
        className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
        autoFocus
      />
      <button type="submit" disabled={pending}
        className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "…" : "Simpan"}
      </button>
      <button type="button" onClick={onDone} disabled={pending}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
        Batal
      </button>
      {error && <span className="ml-1 text-xs text-red-700">{error}</span>}
    </form>
  );
}

/** Hapus peserta dari project — konfirmasi native, lalu panggil removeParticipant. */
function DeleteParticipantButton({ projectId, creatorId, creatorName }: { projectId: number; creatorId: string; creatorName: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Keluarkan "${creatorName}" dari project ini? GMV yang sudah ter-upload tidak hilang, hanya keanggotaannya yang dihapus.`)) return;
          setError(null);
          const formData = new FormData();
          formData.set("project_id", String(projectId));
          formData.set("creator_id", creatorId);
          startTransition(async () => {
            const res = await removeParticipant(formData);
            if (!res.ok) setError(res.error);
          });
        }}
        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Menghapus…" : "Hapus"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

/**
 * Performa per Kreator: klik header untuk urut naik/turun, paginasi 10/50/100.
 * `canManage` (SPV/Head/Director) menambah kolom Aksi — edit target GMV & keluarkan
 * peserta; GMV aktual/item tetap read-only (datanya dari upload, CLAUDE.md #3).
 */
export function CreatorPerformanceTable({
  rows, projectId, canManage = false,
}: {
  rows: CreatorPerformanceRow[];
  projectId?: number;
  canManage?: boolean;
}) {
  const controls = useTableControls<CreatorPerformanceRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_50_100,
    itemLabel: "kreator",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const showActions = canManage && projectId !== undefined;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="creator">Creator</SortableTh>
              <SortableTh controls={controls} sortKey="cm">CM</SortableTh>
              <SortableTh controls={controls} sortKey="target">Target GMV</SortableTh>
              <SortableTh controls={controls} sortKey="gmv">GMV Aktual</SortableTh>
              <SortableTh controls={controls} sortKey="items">Item Terjual</SortableTh>
              <SortableTh controls={controls} sortKey="pct">% Target</SortableTh>
              <SortableTh controls={controls} sortKey="kontribusi">Kontribusi Project</SortableTh>
              {showActions && <th className="px-4 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => (
              <tr key={r.creatorId}>
                <td className="px-4 py-2 font-medium">
                  {r.creatorName}
                  <span className="ml-1 text-xs text-slate-400">{r.creatorId}</span>
                </td>
                <td className="px-4 py-2">
                  {r.cmName ?? <span className="text-amber-700">Belum ada CM</span>}
                </td>
                <td className="px-4 py-2">
                  {showActions && editingId === r.creatorId ? (
                    <EditTargetForm
                      projectId={projectId}
                      creatorId={r.creatorId}
                      initialTarget={r.targetGmv}
                      onDone={() => setEditingId(null)}
                    />
                  ) : (
                    rupiah(r.targetGmv)
                  )}
                </td>
                <td className="px-4 py-2">{rupiah(r.gmv)}</td>
                <td className="px-4 py-2">{r.items || "—"}</td>
                <td className="px-4 py-2">
                  {r.pctTarget === null ? (
                    "—"
                  ) : (
                    <span
                      className={
                        r.pctTarget >= 1
                          ? "font-medium text-green-700"
                          : r.pctTarget < 0.5
                            ? "text-red-700"
                            : "text-amber-700"
                      }
                    >
                      {(r.pctTarget * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{(r.contribution * 100).toFixed(0)}%</td>
                {showActions && (
                  <td className="px-4 py-2">
                    {editingId !== r.creatorId && (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingId(r.creatorId)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <DeleteParticipantButton projectId={projectId} creatorId={r.creatorId} creatorName={r.creatorName} />
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {controls.total === 0 && (
              <tr>
                <td colSpan={showActions ? 8 : 7} className="px-4 py-6 text-center text-slate-400">
                  Belum ada peserta.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {controls.total > 0 && <TablePagination controls={controls} />}
    </div>
  );
}

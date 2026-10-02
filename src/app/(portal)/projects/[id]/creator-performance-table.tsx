"use client";

import { useState, useTransition } from "react";
import {
  PAGE_SIZES_10_50_100,
  SortableTh,
  TablePagination,
  useTableControls,
  type SortConfig,
} from "@/components/table-controls";
import { removeParticipant, updateParticipantNotes, updateParticipantTarget } from "../actions";

/** Pilihan tetap kolom "Ads By" — multi-pilihan, kosong secara default. */
const ADS_BY_OPTIONS = ["MEA", "Brand"] as const;

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
  /** Teks bebas, kosong secara default — diisi tim lewat form edit. */
  analisa: string | null;
  /** Teks bebas, kosong secara default — diisi tim lewat form edit. */
  brandPairs: string | null;
  /** Multi-pilihan tetap (MEA/Brand), kosong secara default. */
  adsBy: string[];
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
    analisa: { value: (r) => r.analisa ?? "" },
    brandPairs: { value: (r) => r.brandPairs ?? "" },
    adsBy: { value: (r) => r.adsBy.join(", ") },
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

/**
 * Field teks bebas (Analisa / Brand Pairs) — tampil sebagai teks + tombol "Edit"
 * kecil, berubah jadi form saat diklik. Kosong ("—") = belum diisi (default).
 */
function InlineTextField({
  projectId, creatorId, field, initialValue,
}: {
  projectId: number; creatorId: string; field: "analisa" | "brand_pairs"; initialValue: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="max-w-[160px] truncate" title={initialValue ?? undefined}>{initialValue || "—"}</span>
        <button
          type="button"
          onClick={() => { setValue(initialValue ?? ""); setError(null); setEditing(true); }}
          className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs hover:bg-slate-50"
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const formData = new FormData();
        formData.set("project_id", String(projectId));
        formData.set("creator_id", creatorId);
        formData.set(field, value);
        startTransition(async () => {
          const res = await updateParticipantNotes(formData);
          if (res.ok) setEditing(false);
          else setError(res.error);
        });
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
        autoFocus
      />
      <button type="submit" disabled={pending}
        className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "…" : "Simpan"}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={pending}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
        Batal
      </button>
      {error && <span className="ml-1 text-xs text-red-700">{error}</span>}
    </form>
  );
}

/**
 * Dropdown "Ads By" (MEA / Brand) — simpan langsung saat pilihan berubah, kosong =
 * belum diisi (default). Gagal simpan → kembali ke nilai semula. `ads_by_touched`
 * selalu dikirim supaya server tahu field ini disentuh walau hasilnya kosong.
 */
function AdsBySelect({
  projectId, creatorId, initialValue,
}: {
  projectId: number; creatorId: string; initialValue: string[];
}) {
  const [value, setValue] = useState<string>(initialValue[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const previous = value;
          setValue(next);
          setError(null);
          const formData = new FormData();
          formData.set("project_id", String(projectId));
          formData.set("creator_id", creatorId);
          formData.set("ads_by_touched", "1");
          if (next) formData.append("ads_by", next);
          startTransition(async () => {
            const res = await updateParticipantNotes(formData);
            if (!res.ok) {
              setValue(previous);
              setError(res.error);
            }
          });
        }}
        className="min-w-[92px] rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
      >
        <option value="">—</option>
        {ADS_BY_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
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
 * Kolom Aksi: `canEditTarget` (management + leader) = edit target GMV, `canManage`
 * (SPV/Head/Director) = keluarkan peserta; GMV aktual/item tetap read-only (datanya dari upload, CLAUDE.md #3).
 */
export function CreatorPerformanceTable({
  rows, projectId, canManage = false, canEditTarget = false, canEditNotes = false,
}: {
  rows: CreatorPerformanceRow[];
  projectId?: number;
  /** SPV/Head/Director: keluarkan peserta. */
  canManage?: boolean;
  /** Management + leader (m7.edit_target): ubah Target GMV per kreator. */
  canEditTarget?: boolean;
  /** Semua role staff: kolom Analisa, Brand Pairs, Ads By. */
  canEditNotes?: boolean;
}) {
  const controls = useTableControls<CreatorPerformanceRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_50_100,
    itemLabel: "kreator",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const showActions = (canManage || canEditTarget) && projectId !== undefined;
  const showNotes = canEditNotes && projectId !== undefined;

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
              <SortableTh controls={controls} sortKey="analisa">Analisa</SortableTh>
              <SortableTh controls={controls} sortKey="brandPairs">Brand Pairs</SortableTh>
              <SortableTh controls={controls} sortKey="adsBy">Ads By</SortableTh>
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
                  {showActions && canEditTarget && editingId === r.creatorId ? (
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
                <td className="px-4 py-2">
                  {showNotes ? (
                    <InlineTextField projectId={projectId as number} creatorId={r.creatorId} field="analisa" initialValue={r.analisa} />
                  ) : (
                    r.analisa ?? "—"
                  )}
                </td>
                <td className="px-4 py-2">
                  {showNotes ? (
                    <InlineTextField projectId={projectId as number} creatorId={r.creatorId} field="brand_pairs" initialValue={r.brandPairs} />
                  ) : (
                    r.brandPairs ?? "—"
                  )}
                </td>
                <td className="px-4 py-2">
                  {showNotes ? (
                    <AdsBySelect projectId={projectId as number} creatorId={r.creatorId} initialValue={r.adsBy} />
                  ) : (
                    r.adsBy.length ? r.adsBy.join(", ") : "—"
                  )}
                </td>
                {showActions && (
                  <td className="px-4 py-2">
                    {editingId !== r.creatorId && (
                      <span className="inline-flex items-center gap-1">
                        {canEditTarget && (
                          <button
                            type="button"
                            onClick={() => setEditingId(r.creatorId)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            Edit Target
                          </button>
                        )}
                        {canManage && (
                          <DeleteParticipantButton projectId={projectId} creatorId={r.creatorId} creatorName={r.creatorName} />
                        )}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {controls.total === 0 && (
              <tr>
                <td colSpan={showActions ? 11 : 10} className="px-4 py-6 text-center text-slate-400">
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

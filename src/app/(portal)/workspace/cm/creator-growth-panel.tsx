"use client";

import { useActionState, useEffect, useState } from "react";
import { rupiah, pct } from "@/lib/utils/format";
import {
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
  type FacetDef,
  type SortConfig,
} from "@/components/table-controls";
import { creatorClassLabel } from "@/lib/creators/creator-class";
import { assignCreator } from "./actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/** Berapa lama notifikasi "Re-assign berhasil" tetap terlihat sebelum hilang sendiri. */
const NOTICE_MS = 5000;

/**
 * Form re-assign CPM satu baris + notifikasi hasilnya.
 *
 * Sebelumnya form ini memakai `action={assignCreator}` polos: kalau berhasil
 * halaman ter-revalidate tanpa tanda apa pun (user tidak tahu tersimpan atau
 * tidak), dan kalau gagal action-nya melempar sehingga seluruh halaman jatuh ke
 * error boundary. Sekarang action mengembalikan status, ditampilkan sebagai
 * notifikasi kecil di baris yang bersangkutan.
 */
function AssignCpmForm({
  creatorId,
  currentCpmId,
  cpms,
}: {
  creatorId: string;
  currentCpmId: string | null;
  cpms: CpmOption[];
}) {
  const [state, formAction, pending] = useActionState(assignCreator, null);
  const [visible, setVisible] = useState(false);

  // Notifikasi sukses hilang sendiri; error dibiarkan sampai percobaan berikutnya
  // supaya pesan penyebabnya sempat terbaca.
  useEffect(() => {
    if (!state) return;
    setVisible(true);
    if (!state.ok) return;
    const t = setTimeout(() => setVisible(false), NOTICE_MS);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <div>
      <form action={formAction} className="flex items-center gap-1">
        <input type="hidden" name="creator_id" value={creatorId} />
        <select
          name="owner_cpm_id"
          defaultValue={currentCpmId ?? ""}
          aria-label="CPM tujuan"
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">— pilih CPM —</option>
          {cpms.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className={`${btnSmall} bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50`}
        >
          {pending ? "…" : "Assign"}
        </button>
      </form>
      {state && visible && (
        <p
          role="status"
          className={`mt-1 text-xs ${state.ok ? "text-green-700" : "text-red-600"}`}
        >
          {state.ok ? "✓ " : "⚠ "}
          {state.message}
        </p>
      )}
    </div>
  );
}

/** Satu baris tabel Creator & Growth Mingguan (growth sudah dihitung server — CLAUDE.md #4). */
export interface CreatorGrowthRow {
  creatorId: string;
  name: string;
  username: string | null;
  ownerCpmId: string | null;
  cmName: string | null;
  /** creators.creator_class (reguler|top_creator|influencer|eksternal); null = reguler. */
  creatorClass: string | null;
  /** Kategori/niche utama kreator; null = belum ada. */
  kategori: string | null;
  level: number | null;
  segment: string | null;
  /** GMV periode terakhir; null = belum ada periode. */
  current: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** % vs periode sebelumnya; null = tidak bisa dibandingkan. */
  delta: number | null;
}

export interface PerfAlert {
  id: number | string;
  message: string;
}

export interface CpmOption {
  id: string;
  name: string;
}

// Search "berdasarkan kreator": cocokkan nama ATAU username, biar CM bisa pakai keduanya.
const searchCreator = (r: CreatorGrowthRow) => `${r.name} ${r.username ?? ""}`;
const rowCm = (r: CreatorGrowthRow) => ({ id: r.ownerCpmId, name: r.cmName });

/** Filter kelas kreator (selalu ada nilai — null = Reguler) & kategori/niche utama. */
const FACETS: FacetDef<CreatorGrowthRow>[] = [
  {
    key: "kelas",
    label: "Kelas",
    value: (r) => {
      const label = creatorClassLabel(r.creatorClass);
      return { value: label, label };
    },
  },
  {
    key: "kategori",
    label: "Kategori",
    value: (r) => (r.kategori ? { value: r.kategori, label: r.kategori } : null),
    emptyLabel: "Belum ada kategori/niche pada data ini.",
  },
];

/** Kolom yang bisa diurutkan lewat klik header; GMV & delta default turun. */
const SORT: SortConfig<CreatorGrowthRow> = {
  columns: {
    creator: { value: (r) => r.username || r.name },
    cm: { value: (r) => r.cmName },
    kelas: { value: (r) => creatorClassLabel(r.creatorClass) },
    kategori: { value: (r) => r.kategori },
    level: { value: (r) => r.level, firstDir: "desc" },
    segment: { value: (r) => r.segment },
    gmv: { value: (r) => r.current, firstDir: "desc" },
    delta: { value: (r) => r.delta, firstDir: "desc" },
  },
  initial: { key: "gmv", dir: "desc" },
};

/**
 * Creator & Growth Mingguan: alert performa sebagai card yang bisa di-minimize
 * (default terbuka supaya alert tetap terlihat), lalu tabel dengan search kreator,
 * filter CM / kelas kreator / kategori, urut lewat klik header, dan paginasi
 * 10/20/50. Read-only kecuali re-assign CPM (server action).
 */
export function CreatorGrowthPanel({
  rows,
  alerts,
  cpms,
  canAssign,
}: {
  rows: CreatorGrowthRow[];
  alerts: PerfAlert[];
  cpms: CpmOption[];
  canAssign: boolean;
}) {
  const controls = useTableControls<CreatorGrowthRow>({
    rows,
    searchText: searchCreator,
    cm: rowCm,
    facets: FACETS,
    sort: SORT,
    itemLabel: "kreator",
  });

  return (
    <>
      {alerts.length > 0 && (
        <details open className="mt-3 rounded-lg border border-red-200 bg-red-50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-red-800">
            ⚠ Alert performa ({alerts.length}) — klik untuk sembunyikan / tampilkan
          </summary>
          <div className="space-y-1 border-t border-red-200 px-3 py-2 text-sm text-red-800">
            {alerts.map((a) => (
              <p key={a.id}>⚠ {a.message}</p>
            ))}
          </div>
        </details>
      )}

      <TableFilterBar controls={controls} searchPlaceholder="Cari kreator (nama / username)…" className="mt-3" />

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="creator">Creator</SortableTh>
                <SortableTh controls={controls} sortKey="cm">CM</SortableTh>
                <SortableTh controls={controls} sortKey="kelas">Kelas</SortableTh>
                <SortableTh controls={controls} sortKey="kategori">Kategori</SortableTh>
                <SortableTh controls={controls} sortKey="level">Level</SortableTh>
                <SortableTh controls={controls} sortKey="segment">Segmen</SortableTh>
                <SortableTh controls={controls} sortKey="gmv">GMV periode terakhir</SortableTh>
                <SortableTh controls={controls} sortKey="delta">vs periode lalu</SortableTh>
                {canAssign && <th className="px-4 py-3">Re-assign CPM</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((c) => (
                <tr key={c.creatorId}>
                  <td className="px-4 py-2 font-medium">
                    {c.name}{" "}
                    {c.username && <span className="text-xs text-slate-500">@{c.username}</span>}{" "}
                    <span className="text-xs text-slate-400">{c.creatorId}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{c.cmName ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600">{creatorClassLabel(c.creatorClass)}</td>
                  <td className="px-4 py-2 text-slate-600">{c.kategori ?? "—"}</td>
                  <td className="px-4 py-2">
                    {c.level ? `L${c.level}` : "—"}{" "}
                    {c.level && c.level < 6 && <span className="text-xs text-slate-400">→ L{c.level + 1}</span>}
                  </td>
                  <td className="px-4 py-2">{c.segment ?? "—"}</td>
                  <td className="px-4 py-2">
                    {c.current !== null ? `${rupiah(c.current)} (${c.periodStart}–${c.periodEnd})` : "—"}
                  </td>
                  <td className={`px-4 py-2 ${c.delta !== null && c.delta < 0 ? "text-red-600" : "text-green-700"}`}>
                    {pct(c.delta)}
                  </td>
                  {canAssign && (
                    <td className="px-4 py-2">
                      <AssignCpmForm
                        creatorId={c.creatorId}
                        currentCpmId={c.ownerCpmId}
                        cpms={cpms}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={canAssign ? 9 : 8} className="px-4 py-6 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada kreator yang cocok dengan pencarian / filter CM, kelas, atau kategori."
                      : "Belum ada creator di scope ini."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination controls={controls} />
      </div>
    </>
  );
}

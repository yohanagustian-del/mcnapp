"use client";

import {
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
  type FacetDef,
  type SortConfig,
} from "@/components/table-controls";
import { creatorClassLabel } from "@/lib/creators/creator-class";
import { CreatorLeakDetailButton } from "./creator-leak-detail-button";

/** Satu baris rollup kebocoran per kreator untuk minggu terakhir (sudah dihitung server). */
export interface CreatorStatusRow {
  creatorId: string;
  name: string;
  /** creators.creator_class (reguler|top_creator|influencer|eksternal); null = reguler. */
  creatorClass: string | null;
  ownerCpmId: string | null;
  cmName: string | null;
  gmvDealTotal: number | null;
  gmvBocor: number | null;
  gmvBocorShopBasis: number | null;
  leakRatio: number | null;
  /** null = artifak v2 (breakdown per kreator tidak ada), BUKAN via_agency/0. */
  linkStatus: string | null;
  /** creator_link_status.source — artifact | platform | engine. */
  source: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  via_agency: "Via Link Agency",
  bocor_sebagian: "Bocor Sebagian",
  bocor_total: "Bocor Total",
  belum_ada_link: "Belum Ada Link",
};
const STATUS_STYLES: Record<string, string> = {
  via_agency: "bg-green-100 text-green-800",
  bocor_sebagian: "bg-amber-100 text-amber-800",
  bocor_total: "bg-red-100 text-red-800",
  belum_ada_link: "bg-slate-100 text-slate-600",
};
/**
 * Label + style untuk link_status = NULL (artifak format v2 — "Ringkasan Creator"
 * tidak punya breakdown bocor/TAP per kreator, jadi status memang tidak diketahui,
 * BUKAN via_agency/0 — lihat leak-artifact.ts writeUnknownLeakRollups).
 */
const UNKNOWN_STATUS_LABEL = "Belum diketahui (artifak v2)";
const UNKNOWN_STATUS_STYLE = "bg-slate-100 text-slate-500";

/** creator_link_status.source → pill kecil di kolom kreator. */
const ROW_SOURCE_PILLS: Record<string, { label: string; style: string }> = {
  artifact: { label: "artifak", style: "bg-indigo-100 text-indigo-700" },
  platform: { label: "platform", style: "bg-emerald-100 text-emerald-700" },
  engine: { label: "engine (lama)", style: "bg-slate-100 text-slate-600" },
};

const rupiah = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);

/** Urutan status dari paling sehat ke paling bocor — dipakai sort kolom Status. */
const STATUS_ORDER: Record<string, number> = {
  via_agency: 1,
  bocor_sebagian: 2,
  bocor_total: 3,
  belum_ada_link: 4,
};

const searchName = (r: CreatorStatusRow) => `${r.name} ${r.creatorId}`;
const rowCm = (r: CreatorStatusRow) => ({ id: r.ownerCpmId, name: r.cmName });

/**
 * Filter kelas kreator + status link. Kelas selalu punya nilai (null = Reguler,
 * default kolom DB), jadi opsinya tidak pernah kosong.
 */
const FACETS: FacetDef<CreatorStatusRow>[] = [
  {
    key: "kelas",
    label: "Kelas",
    value: (r) => {
      const label = creatorClassLabel(r.creatorClass);
      return { value: label, label };
    },
  },
  {
    key: "status",
    label: "Status link",
    value: (r) =>
      r.linkStatus
        ? { value: r.linkStatus, label: STATUS_LABELS[r.linkStatus] ?? r.linkStatus }
        : { value: "unknown", label: UNKNOWN_STATUS_LABEL },
  },
];

/** Kolom yang bisa diurutkan lewat klik header. Angka & rasio default turun (terbesar dulu). */
const SORT: SortConfig<CreatorStatusRow> = {
  columns: {
    creator: { value: (r) => r.name },
    kelas: { value: (r) => creatorClassLabel(r.creatorClass) },
    cm: { value: (r) => r.cmName },
    deal: { value: (r) => r.gmvDealTotal, firstDir: "desc" },
    bocor: { value: (r) => r.gmvBocor, firstDir: "desc" },
    rasio: { value: (r) => r.leakRatio, firstDir: "desc" },
    // Status diurut berdasarkan tingkat kebocoran, bukan abjad: "Bocor Total" harus
    // berada di ujung yang sama dengan rasio tertinggi, bukan di antara B dan V.
    status: { value: (r) => (r.linkStatus ? STATUS_ORDER[r.linkStatus] ?? 5 : 9) },
  },
  initial: { key: "rasio", dir: "desc" },
};

/**
 * Tabel "Status Creator" di /link-leakage — search nama/ID kreator, filter CM +
 * kelas kreator + status link, urut lewat klik header (naik ⇄ turun), paginasi
 * 10/20/50.
 *
 * Semua filter/sort/paginasi client-side: rollup satu minggu sudah dimuat server
 * component, jadi mengetik atau menyortir tidak memicu query Supabase baru. Angka
 * di sini murni BACAAN rollup (creator_link_status) — tidak dihitung ulang di klien
 * (CLAUDE.md #4), dan tidak ada jalur edit manual (CLAUDE.md #3).
 */
export function CreatorStatusTable({
  rows,
  week,
}: {
  rows: CreatorStatusRow[];
  /**
   * Minggu rollup yang sedang ditampilkan. Tombol unduh detail per kreator butuh
   * minggu yang PERSIS sama dengan barisnya — tanpa itu tombolnya tidak dirender,
   * bukan mengunduh minggu tebakan.
   */
  week: string | null;
}) {
  const controls = useTableControls<CreatorStatusRow>({
    rows,
    searchText: searchName,
    cm: rowCm,
    facets: FACETS,
    sort: SORT,
    itemLabel: "kreator",
  });

  return (
    <>
      <TableFilterBar
        controls={controls}
        searchPlaceholder="Cari nama / ID kreator…"
        className="mt-3"
      />

      <div className="mt-2 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="creator">Creator</SortableTh>
                <SortableTh controls={controls} sortKey="kelas">Kelas</SortableTh>
                <SortableTh controls={controls} sortKey="cm">CM</SortableTh>
                <SortableTh controls={controls} sortKey="deal">GMV Shop Ber-deal</SortableTh>
                <SortableTh controls={controls} sortKey="bocor">GMV Bocor</SortableTh>
                <SortableTh controls={controls} sortKey="rasio">Rasio</SortableTh>
                <SortableTh controls={controls} sortKey="status">Status</SortableTh>
                {week && <th className="px-4 py-3">Detail</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((r) => (
                <tr key={r.creatorId}>
                  <td className="px-4 py-2 font-medium">
                    {r.name}
                    <span className="ml-1 text-xs text-slate-400">{r.creatorId}</span>
                    {r.source && ROW_SOURCE_PILLS[r.source] && (
                      <span className={`ml-1 rounded px-1 text-[10px] ${ROW_SOURCE_PILLS[r.source].style}`}>
                        {ROW_SOURCE_PILLS[r.source].label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{creatorClassLabel(r.creatorClass)}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {r.cmName ?? <span className="text-amber-700">belum ada CM</span>}
                  </td>
                  <td className="px-4 py-2">{rupiah(r.gmvDealTotal)}</td>
                  <td className="px-4 py-2">
                    {rupiah(r.gmvBocor)}
                    {r.gmvBocorShopBasis !== null && (
                      <span className="block text-[10px] text-slate-400">
                        basis shop: {rupiah(r.gmvBocorShopBasis)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.leakRatio === null ? "—" : `${(r.leakRatio * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-2">
                    {r.linkStatus === null ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${UNKNOWN_STATUS_STYLE}`}
                        title="Artifak format ringkas (v2) tidak punya breakdown bocor per kreator"
                      >
                        {UNKNOWN_STATUS_LABEL}
                      </span>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.linkStatus] ?? ""}`}
                      >
                        {STATUS_LABELS[r.linkStatus] ?? r.linkStatus}
                      </span>
                    )}
                  </td>
                  {week && (
                    <td className="px-4 py-2">
                      {/* Unduh detail produk bocor kreator ini (CSV). Sumber & aturan
                          scope-nya sama dengan tombol Detail di CM Workspace — satu
                          server action, bukan salinan kedua. */}
                      <CreatorLeakDetailButton
                        creatorId={r.creatorId}
                        week={week}
                        label="⤓ Detail bocor"
                      />
                    </td>
                  )}
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={week ? 8 : 7} className="px-4 py-6 text-center text-slate-400">
                    {rows.length === 0
                      ? "Belum ada rollup. Jalankan analisa kebocoran di atas atau upload mingguan lewat menu Upload Mingguan (Ingest)."
                      : "Tidak ada kreator yang cocok dengan filter."}
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

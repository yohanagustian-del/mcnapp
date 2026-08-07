"use client";

import {
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
  type FacetDef,
  type SortConfig,
} from "@/components/table-controls";

/** Satu shop non-deal yang muncul di data platform — kandidat garapan BizDev. */
export interface BdLeadRow {
  shopId: string;
  shopName: string | null;
  frequency: number;
  totalGmv: number | null;
  priorityScore: number;
  firstSeenWeek: string | null;
  status: string;
}

const rupiah = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);

const searchShop = (r: BdLeadRow) => `${r.shopName ?? ""} ${r.shopId}`;

const FACETS: FacetDef<BdLeadRow>[] = [
  { key: "status", label: "Status", value: (r) => ({ value: r.status, label: r.status }) },
];

const SORT: SortConfig<BdLeadRow> = {
  columns: {
    shop: { value: (r) => r.shopName ?? r.shopId },
    frekuensi: { value: (r) => r.frequency, firstDir: "desc" },
    gmv: { value: (r) => r.totalGmv, firstDir: "desc" },
    prioritas: { value: (r) => r.priorityScore, firstDir: "desc" },
    pertama: { value: (r) => r.firstSeenWeek, firstDir: "desc" },
    status: { value: (r) => r.status },
  },
  initial: { key: "prioritas", dir: "desc" },
};

/**
 * Tabel "Lead BizDev (shop non-deal)" — search nama/ID shop, filter status, urut
 * lewat klik header, paginasi 10/20/50. Bacaan `bd_leads` apa adanya; status lead
 * tetap dikelola BizDev di modul lain, halaman ini tidak mengubah apa pun.
 */
export function BdLeadsTable({ rows }: { rows: BdLeadRow[] }) {
  const controls = useTableControls<BdLeadRow>({
    rows,
    searchText: searchShop,
    facets: FACETS,
    sort: SORT,
    itemLabel: "lead",
  });

  return (
    <>
      <TableFilterBar controls={controls} searchPlaceholder="Cari nama / ID shop…" className="mt-2" />

      <div className="mt-2 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="shop">Shop / ID</SortableTh>
                <SortableTh controls={controls} sortKey="frekuensi">Frekuensi</SortableTh>
                <SortableTh controls={controls} sortKey="gmv">Total GMV</SortableTh>
                <SortableTh controls={controls} sortKey="prioritas">Prioritas</SortableTh>
                <SortableTh controls={controls} sortKey="pertama">Pertama Terlihat</SortableTh>
                <SortableTh controls={controls} sortKey="status">Status</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((l) => (
                <tr key={l.shopId}>
                  <td className="px-4 py-2">
                    {l.shopName ? (
                      <>
                        {l.shopName}
                        <span className="block font-mono text-xs text-slate-400">{l.shopId}</span>
                      </>
                    ) : (
                      <span className="font-mono text-xs">{l.shopId}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{l.frequency}</td>
                  <td className="px-4 py-2">{rupiah(l.totalGmv)}</td>
                  <td className="px-4 py-2">{Number(l.priorityScore).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{l.firstSeenWeek ?? "—"}</td>
                  <td className="px-4 py-2">{l.status}</td>
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    {rows.length === 0 ? "Belum ada lead." : "Tidak ada lead yang cocok dengan filter."}
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

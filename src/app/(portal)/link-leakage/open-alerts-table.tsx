"use client";

import {
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
  type FacetDef,
  type SortConfig,
} from "@/components/table-controls";

/** Satu alert platform yang belum di-resolve (platform_alerts.resolved = false). */
export interface OpenAlertRow {
  id: number;
  alertType: string;
  entityId: string | null;
  message: string;
  week: string | null;
  createdAt: string | null;
}

/** Warna per jenis alert; jenis yang belum dikenal jatuh ke abu-abu, bukan tanpa warna. */
const ALERT_STYLES: Record<string, string> = {
  link_bocor: "bg-red-100 text-red-800",
  deal_expired: "bg-red-100 text-red-800",
  deal_expiring: "bg-amber-100 text-amber-800",
  commission_drop: "bg-amber-100 text-amber-800",
  token_regression: "bg-slate-100 text-slate-700",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("id-ID");
}

const searchAlert = (r: OpenAlertRow) => `${r.message} ${r.entityId ?? ""} ${r.alertType}`;

const FACETS: FacetDef<OpenAlertRow>[] = [
  { key: "tipe", label: "Jenis", value: (r) => ({ value: r.alertType, label: r.alertType }) },
  {
    key: "minggu",
    label: "Minggu",
    value: (r) => (r.week ? { value: r.week, label: r.week } : null),
    sortBy: "value",
    emptyLabel: "Alert pada data ini tidak punya minggu.",
  },
];

const SORT: SortConfig<OpenAlertRow> = {
  columns: {
    tipe: { value: (r) => r.alertType },
    pesan: { value: (r) => r.message },
    minggu: { value: (r) => r.week, firstDir: "desc" },
    dibuat: { value: (r) => r.createdAt, firstDir: "desc" },
  },
  initial: { key: "dibuat", dir: "desc" },
};

/**
 * Tabel "Alert Terbuka" — search pesan/entitas, filter jenis & minggu, urut lewat
 * klik header, paginasi 10/20/50.
 *
 * Sebelumnya daftar kartu tanpa header: begitu satu upload mingguan menghasilkan
 * puluhan alert, tidak ada cara mengurutkan atau menelusurinya. Alert TIDAK bisa
 * diubah dari sini — ini event dari data platform (CLAUDE.md #2), bukan approval.
 */
export function OpenAlertsTable({ rows }: { rows: OpenAlertRow[] }) {
  const controls = useTableControls<OpenAlertRow>({
    rows,
    searchText: searchAlert,
    facets: FACETS,
    sort: SORT,
    itemLabel: "alert",
  });

  return (
    <>
      <TableFilterBar controls={controls} searchPlaceholder="Cari pesan / entitas…" className="mt-2" />

      <div className="mt-2 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="tipe">Jenis</SortableTh>
                <SortableTh controls={controls} sortKey="pesan">Pesan</SortableTh>
                <SortableTh controls={controls} sortKey="minggu">Minggu</SortableTh>
                <SortableTh controls={controls} sortKey="dibuat">Dibuat</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ALERT_STYLES[a.alertType] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {a.alertType}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{a.message}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{a.week ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{formatWhen(a.createdAt)}</td>
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    {rows.length === 0
                      ? "Tidak ada alert terbuka."
                      : "Tidak ada alert yang cocok dengan filter."}
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

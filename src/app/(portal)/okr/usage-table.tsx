"use client";

import { useMemo } from "react";
import {
  PAGE_SIZES_10_50_100,
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
} from "@/components/table-controls";
import { formatWeekLabel } from "@/lib/m3/usage";

export interface UsageRow {
  memberId: string;
  memberName: string;
  role: string;
  weekStart: string; // YYYY-MM-DD (Senin)
  month: string; // YYYY-MM
  hours: number;
  sessions: number;
  pageViews: number;
  /** ISO timestamp akses terakhir (dari tool_usage_logs), null kalau tak ada di window. */
  lastAccess: string | null;
  /** Timestamp + label aktivitas terakhir (dari audit_logs), null kalau belum pernah. */
  lastActivity: { at: string; label: string } | null;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });
}

const MONTH_LABEL: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "Mei", "06": "Jun",
  "07": "Jul", "08": "Agu", "09": "Sep", "10": "Okt", "11": "Nov", "12": "Des",
};

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_LABEL[m] ?? m} ${y}`;
}

/**
 * Tabel "Adopsi Sistem — Jam Pemakaian Tools": header asc/desc, filter bulan
 * (facet, diturunkan dari minggu yang benar-benar ada data), plus kolom
 * Last Access (tool_usage_logs terakhir) & Last Activity (audit_logs terakhir).
 */
export function UsageAdoptionTable({ rows }: { rows: UsageRow[] }) {
  const controls = useTableControls<UsageRow>({
    rows,
    searchText: (r) => `${r.memberName} ${r.role}`,
    facets: useMemo(
      () => [
        {
          key: "month",
          label: "Bulan",
          value: (r: UsageRow) => ({ value: r.month, label: monthLabel(r.month) }),
          sortBy: "value" as const,
        },
      ],
      []
    ),
    sort: useMemo(
      () => ({
        columns: {
          week: { value: (r: UsageRow) => r.weekStart, firstDir: "desc" as const },
          name: { value: (r: UsageRow) => r.memberName },
          role: { value: (r: UsageRow) => r.role },
          hours: { value: (r: UsageRow) => r.hours, firstDir: "desc" as const },
          sessions: { value: (r: UsageRow) => r.sessions, firstDir: "desc" as const },
          pageViews: { value: (r: UsageRow) => r.pageViews, firstDir: "desc" as const },
          lastAccess: { value: (r: UsageRow) => r.lastAccess, firstDir: "desc" as const },
          lastActivity: { value: (r: UsageRow) => r.lastActivity?.at ?? null, firstDir: "desc" as const },
        },
        initial: { key: "week", dir: "desc" as const },
      }),
      []
    ),
    pageSizes: PAGE_SIZES_10_50_100,
    itemLabel: "baris",
  });

  return (
    <div className="mt-3 space-y-2">
      <TableFilterBar controls={controls} searchPlaceholder="Cari nama / role tim…" />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="week">Minggu</SortableTh>
              <SortableTh controls={controls} sortKey="name">Anggota</SortableTh>
              <SortableTh controls={controls} sortKey="role">Role</SortableTh>
              <SortableTh controls={controls} sortKey="hours">Jam / Minggu</SortableTh>
              <SortableTh controls={controls} sortKey="sessions">Sesi</SortableTh>
              <SortableTh controls={controls} sortKey="pageViews">Page View</SortableTh>
              <SortableTh controls={controls} sortKey="lastAccess">Last Access</SortableTh>
              <SortableTh controls={controls} sortKey="lastActivity">Last Activity</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((u) => (
              <tr key={`${u.memberId}-${u.weekStart}`}>
                <td className="px-4 py-2 font-mono text-xs">{formatWeekLabel(u.weekStart)}</td>
                <td className="px-4 py-2 font-medium">{u.memberName}</td>
                <td className="px-4 py-2">{u.role}</td>
                <td className="px-4 py-2 font-semibold">{u.hours} jam</td>
                <td className="px-4 py-2">{u.sessions}</td>
                <td className="px-4 py-2">{u.pageViews}</td>
                <td className="px-4 py-2 text-xs">{fmtDateTime(u.lastAccess)}</td>
                <td className="px-4 py-2 text-xs">
                  {u.lastActivity ? (
                    <>
                      {u.lastActivity.label}
                      <span className="block text-slate-400">{fmtDateTime(u.lastActivity.at)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {controls.total === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  {controls.filterActive
                    ? "Tidak ada data yang cocok dengan filter."
                    : "Belum ada log pemakaian — log terisi otomatis saat tim membuka halaman."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination controls={controls} />
      </div>
    </div>
  );
}

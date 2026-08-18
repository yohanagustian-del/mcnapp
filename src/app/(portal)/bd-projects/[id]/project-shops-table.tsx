"use client";

import type { ReactNode } from "react";
import {
  PAGE_SIZES_10_20_50_100, SortableTh, TablePagination, useTableControls,
  type SortConfig, type SortDir, type SortValue,
} from "@/components/table-controls";
import { ShopBudgetEditButton } from "./shop-budget-edit-button";

/**
 * Satu shop anggota project. Kolom kartu (produk, campaign, komisi, GMV, exp date)
 * datang dari view `deal_shop_summary` yang sudah diagregasi SQL; `ads_budget` &
 * `service_fee` datang dari `bd_project_shop_budgets` untuk PROJECT INI (0046).
 * Komponen ini hanya menampilkan, mengurutkan, dan memaginasi — tidak ada angka yang
 * dihitung ulang di sini (CLAUDE.md #4).
 */
export interface ProjectShopRow {
  shop_key: string;
  shop_name: string | null;
  shop_id: string | null;
  product_count: number;
  campaign_count: number;
  avg_commission_pct: number | null;
  ads_budget: number | null;
  service_fee: number | null;
  gmv_tap: number | null;
  effective_end: string | null;
}

function formatRp(v: number | null): string {
  return v ? `Rp${Math.round(Number(v)).toLocaleString("id-ID")}` : "—";
}

const td = "px-3 py-2";
const th = "px-3 py-3 whitespace-nowrap";

interface Column {
  key: string;
  label: string;
  value: (s: ProjectShopRow) => SortValue;
  firstDir?: SortDir;
  className?: string;
  cell: (s: ProjectShopRow) => ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: "shop",
    label: "Shop Name",
    value: (s) => s.shop_name ?? s.shop_key,
    className: `${td} font-medium`,
    cell: (s) => s.shop_name ?? s.shop_key,
  },
  {
    key: "shop_id",
    label: "Shop ID",
    value: (s) => s.shop_id,
    className: `${td} font-mono text-xs`,
    cell: (s) => s.shop_id ?? "—",
  },
  { key: "produk", label: "Produk", value: (s) => s.product_count, firstDir: "desc", cell: (s) => s.product_count },
  { key: "campaign", label: "Campaign", value: (s) => s.campaign_count, firstDir: "desc", cell: (s) => s.campaign_count },
  {
    key: "komisi",
    label: "Komisi Kreator",
    value: (s) => s.avg_commission_pct,
    firstDir: "desc",
    cell: (s) => (s.avg_commission_pct != null ? `${s.avg_commission_pct.toFixed(1)}%` : "—"),
  },
  { key: "ads", label: "Ads Budget", value: (s) => s.ads_budget, firstDir: "desc", cell: (s) => formatRp(s.ads_budget) },
  { key: "fee", label: "Service Fee", value: (s) => s.service_fee, firstDir: "desc", cell: (s) => formatRp(s.service_fee) },
  { key: "gmv", label: "GMV TAP", value: (s) => s.gmv_tap, firstDir: "desc", cell: (s) => formatRp(s.gmv_tap) },
  // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
  { key: "exp", label: "Exp Date", value: (s) => s.effective_end, cell: (s) => s.effective_end ?? "—" },
];

const SORT: SortConfig<ProjectShopRow> = {
  columns: Object.fromEntries(
    COLUMNS.map((c) => [c.key, { value: c.value, firstDir: c.firstDir ?? "asc" }] as const)
  ),
  resettable: true,
};

/**
 * Tabel "Shop dalam Project": tiap header bisa diklik untuk mengurutkan naik →
 * turun → urutan bawaan (jumlah kartu terbanyak dulu, urutan dari server), dengan
 * paginasi 10/20/50/100. Semuanya client-side atas baris yang sudah dikirim server.
 */
export function ProjectShopsTable({
  rows,
  projectId,
  projectName,
  canManage = false,
}: {
  rows: ProjectShopRow[];
  projectId: string;
  projectName?: string;
  /** BizDev/management: menampilkan tombol Edit Ads Budget & Service Fee per shop. */
  canManage?: boolean;
}) {
  const controls = useTableControls<ProjectShopRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_20_50_100,
    itemLabel: "shop",
  });

  const colCount = COLUMNS.length + (canManage ? 1 : 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {COLUMNS.map((c) => (
                <SortableTh key={c.key} controls={controls} sortKey={c.key} className={th}>
                  {c.label}
                </SortableTh>
              ))}
              {canManage && <th className={th}>Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((s) => (
              <tr key={s.shop_key} className="hover:bg-slate-50">
                {COLUMNS.map((c) => (
                  <td key={c.key} className={c.className ?? td}>
                    {c.cell(s)}
                  </td>
                ))}
                {canManage && (
                  <td className={`${td} whitespace-nowrap`}>
                    <ShopBudgetEditButton
                      shop={s}
                      projectId={projectId}
                      projectName={projectName}
                    />
                  </td>
                )}
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
                  Belum ada shop di project ini. Tambahkan lewat Edit Project.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination controls={controls} />
    </div>
  );
}

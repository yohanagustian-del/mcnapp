"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PAGE_SIZES_10_20_50_100, SortableTh, TablePagination, useTableControls,
  type SortConfig, type SortDir, type SortValue,
} from "@/components/table-controls";
import { PAYMENT_STATUS_LABEL, PROJECT_STATUS_LABEL } from "@/lib/deals/bd-project";

/**
 * Satu Project BD siap tampil: identitasnya dari `bd_projects`, angka kartunya hasil
 * penjumlahan baris ringkasan shop (view `deal_shop_summary`), dan Ads Budget /
 * Service Fee hasil penjumlahan nominal `bd_project_shop_budgets` PROJECT INI —
 * semuanya dikerjakan server. Komponen ini tidak menghitung apa pun; hanya
 * menampilkan, mengurutkan, dan memaginasi.
 */
export interface ProjectRow {
  id: string;
  name: string;
  status: string | null;
  status_payment: string | null;
  created_at: string | null;
  created_by_name: string | null;
  /** Nama shop anggota project (yang masih ada di katalog), untuk kolom Brand/Shop. */
  shop_names: string[];
  /** Anggota yang kuncinya tidak lagi ketemu di katalog — biasanya shop berganti nama. */
  missing_shops: number;
  shop_count: number;
  product_count: number;
  campaign_count: number;
  ads_budget: number | null;
  service_fee: number | null;
  gmv_tap: number | null;
  effective_end: string | null;
}

function formatRpShort(v: number | null): ReactNode {
  if (!v) return "—";
  const n = Number(v);
  const short =
    n >= 1_000_000_000
      ? `Rp${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`
      : n >= 1_000_000
        ? `Rp${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`
        : `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return <span title={`Rp${Math.round(n).toLocaleString("id-ID")}`}>{short}</span>;
}

/** Daftar nama: dua pertama tampil, sisanya jadi "+n" dengan title lengkap. */
function nameList(values: string[]): ReactNode {
  if (values.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span title={values.join(", ")}>
      {values.slice(0, 2).join(", ")}
      {values.length > 2 && <span className="text-slate-400"> +{values.length - 2}</span>}
    </span>
  );
}

const STATUS_CLASS: Record<string, string> = {
  running: "bg-green-100 text-green-800",
  hold: "bg-amber-100 text-amber-800",
  done: "bg-slate-200 text-slate-700",
};

// Status payment: hijau hanya untuk "done"; dua status "proses" dibedakan warnanya
// supaya barisnya bisa dipilah cepat tanpa membaca teksnya.
const PAYMENT_CLASS: Record<string, string> = {
  done: "bg-green-100 text-green-800",
  proses_finance_payment: "bg-blue-100 text-blue-800",
  proses_finance_brand: "bg-violet-100 text-violet-800",
};

// Kelas sel sengaja sama dengan tabel Deal Brand: dua tabel dengan padding & ukuran
// font berbeda terbaca sebagai dua komponen asing, bukan dua pandangan atas data
// yang sama.
const td = "px-2 py-2 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "px-2 py-3 whitespace-nowrap";

interface TableColumn {
  label: string;
  value?: (p: ProjectRow) => SortValue;
  firstDir?: SortDir;
  cell: (p: ProjectRow) => ReactNode;
  className?: string;
}

const COLUMNS: TableColumn[] = [
  {
    label: "Nama Project",
    value: (p) => p.name,
    className: `${td} max-w-[16rem] truncate font-medium`,
    cell: (p) => (
      <Link href={`/bd-projects/${p.id}`} className="text-blue-700 hover:underline" title={p.name}>
        {p.name}
      </Link>
    ),
  },
  {
    label: "Brand / Shop",
    value: (p) => p.shop_names[0] ?? null,
    className: `${td} max-w-[18rem] truncate`,
    cell: (p) => (
      <>
        {nameList(p.shop_names)}
        {p.missing_shops > 0 && (
          <span
            className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
            title="Shop ini tidak lagi ditemukan — biasanya karena Shop Name-nya diubah. Perbaiki lewat Edit project."
          >
            {p.missing_shops} hilang
          </span>
        )}
      </>
    ),
  },
  {
    label: "Shop",
    value: (p) => p.shop_count,
    firstDir: "desc",
    className: `${td} text-center`,
    cell: (p) => p.shop_count,
  },
  {
    label: "Produk",
    value: (p) => p.product_count,
    firstDir: "desc",
    className: `${td} text-center`,
    cell: (p) => p.product_count,
  },
  {
    label: "Campaign",
    value: (p) => p.campaign_count,
    firstDir: "desc",
    className: `${td} text-center`,
    cell: (p) => p.campaign_count,
  },
  {
    label: "Ads Budget",
    value: (p) => p.ads_budget,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => formatRpShort(p.ads_budget),
  },
  {
    label: "Service Fee",
    value: (p) => p.service_fee,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => formatRpShort(p.service_fee),
  },
  {
    label: "GMV TAP",
    value: (p) => p.gmv_tap,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => formatRpShort(p.gmv_tap),
  },
  // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
  {
    label: "Exp Date",
    value: (p) => p.effective_end,
    cell: (p) => p.effective_end ?? "—",
  },
  {
    label: "Status",
    value: (p) => p.status,
    cell: (p) => (
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[p.status ?? ""] ?? "bg-slate-100 text-slate-700"}`}
      >
        {PROJECT_STATUS_LABEL[p.status ?? ""] ?? "—"}
      </span>
    ),
  },
  {
    label: "Status Payment",
    value: (p) => p.status_payment,
    cell: (p) =>
      p.status_payment ? (
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${PAYMENT_CLASS[p.status_payment] ?? "bg-slate-100 text-slate-700"}`}
        >
          {PAYMENT_STATUS_LABEL[p.status_payment] ?? p.status_payment}
        </span>
      ) : (
        <span className="text-slate-400" title="Status payment belum diisi — atur lewat Edit Project">
          —
        </span>
      ),
  },
  {
    label: "Dibuat oleh",
    value: (p) => p.created_by_name,
    className: `${td} max-w-[10rem] truncate`,
    cell: (p) => p.created_by_name ?? "—",
  },
  {
    label: "Dibuat",
    value: (p) => p.created_at,
    firstDir: "desc",
    cell: (p) => (p.created_at ? p.created_at.slice(0, 10) : "—"),
  },
];

const SORT: SortConfig<ProjectRow> = {
  columns: Object.fromEntries(
    COLUMNS.flatMap((c) =>
      c.value ? [[c.label, { value: c.value, firstDir: c.firstDir ?? "asc" }] as const] : []
    )
  ),
  resettable: true,
};

/**
 * Tabel Project BD. Seluruh barisnya bisa diklik untuk membuka detail project —
 * nama project tetap berupa link sungguhan supaya bisa dibuka di tab baru dan
 * dijangkau keyboard, sementara klik di mana pun pada baris ikut membukanya.
 */
export function ProjectsTable({
  rows,
  emptyMessage,
}: {
  rows: ProjectRow[];
  emptyMessage: string;
}) {
  const router = useRouter();
  const controls = useTableControls<ProjectRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_20_50_100,
    itemLabel: "project",
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2">
        <span className="text-xs text-slate-400">
          Klik baris untuk membuka detail project · klik judul kolom untuk mengurutkan
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {COLUMNS.map((col) =>
                col.value ? (
                  <SortableTh key={col.label} controls={controls} sortKey={col.label} className={th}>
                    {col.label}
                  </SortableTh>
                ) : (
                  <th key={col.label} className={th}>{col.label}</th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((p) => (
              <tr
                key={p.id}
                onClick={() => router.push(`/bd-projects/${p.id}`)}
                className="cursor-pointer hover:bg-slate-50"
              >
                {COLUMNS.map((col) => (
                  <td key={col.label} className={col.className ?? td}>
                    {col.cell(p)}
                  </td>
                ))}
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-slate-400">
                  {emptyMessage}
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

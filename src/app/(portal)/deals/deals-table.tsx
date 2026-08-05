"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  PAGE_SIZE_10, SortableTh, TablePagination, useTableControls,
  type SortConfig, type SortDir, type SortValue,
} from "@/components/table-controls";
import { DealEditButton } from "./deal-edit-button";

/** Satu baris Deal Brand — kolom yang ditampilkan tabel + yang dibutuhkan modal Edit. */
export interface DealRow {
  id: string;
  brand_name: string;
  shop_id: string | null;
  niche: string | null;
  exp_date: string | null;
  komisi_kreator_raw: string | null;
  komisi_kreator_pct: number | null;
  komisi_mea_raw: string | null;
  komisi_mea_pct: number | null;
  ads_budget: number | null;
  service_fee: number | null;
  gmv_tap: number | null;
  avg_price: number | null;
  campaign_name: string | null;
  campaign_type: string | null;
  sourced_by_role: string | null;
  status: string | null;
  notes: string | null;
  review_flags: string[] | null;
  /** Jumlah produk terdaftar (dihitung server dari deal_products). */
  productCount: number;
}

function formatRp(v: number | null | undefined): string {
  return v ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

// Sel & header tidak pernah membungkus baris: tabel ini lebar, jadi kolom dibiarkan
// utuh dan pembacaannya dibantu scroll horizontal (bukan teks yang terpotong/melipat).
const td = "px-3 py-2 whitespace-nowrap";
const th = "px-3 py-3 whitespace-nowrap";

interface TableColumn {
  /** Judul kolom — sekaligus kunci identitas kolom untuk state pengurutan. */
  label: string;
  /** Nilai pengurutan. Kolom tanpa `value` tidak bisa diklik (kolom aksi). */
  value?: (d: DealRow) => SortValue;
  /** Arah klik pertama — kolom angka mulai dari yang terbesar. Default "asc". */
  firstDir?: SortDir;
  cell: (d: DealRow) => ReactNode;
  className?: string;
}

/**
 * Definisi kolom — satu sumber untuk header, isi sel, dan pengurutan, jadi kolom
 * baru tidak mungkin membuat header & isi bergeser.
 *
 * Komisi diurutkan pakai `komisi_*_pct` (angka hasil parse), BUKAN teks rawnya:
 * "5-7%" dan "10%" tidak punya urutan yang bermakna sebagai string.
 */
const COLUMNS: TableColumn[] = [
  {
    label: "ID",
    value: (d) => d.id,
    className: `${td} font-mono text-xs`,
    cell: (d) => (
      <Link href={`/deals/${d.id}`} className="text-blue-700 underline">
        {d.id}
      </Link>
    ),
  },
  {
    label: "Brand",
    value: (d) => d.brand_name,
    className: `${td} font-medium`,
    cell: (d) => (
      <>
        <Link href={`/deals/${d.id}`} className="hover:underline">
          {d.brand_name}
        </Link>
        {d.sourced_by_role === "cm" && (
          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
            via CM
          </span>
        )}
        {d.campaign_type && d.campaign_type !== "paid" && (
          <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
            {d.campaign_type === "sample" ? "sample" : "komisi extra"}
          </span>
        )}
      </>
    ),
  },
  { label: "Shop ID", value: (d) => d.shop_id, cell: (d) => d.shop_id ?? "—" },
  { label: "Niche", value: (d) => d.niche, cell: (d) => d.niche ?? "—" },
  // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
  { label: "Exp Date", value: (d) => d.exp_date, cell: (d) => d.exp_date ?? "—" },
  {
    label: "Komisi Kreator",
    value: (d) => d.komisi_kreator_pct,
    firstDir: "desc",
    cell: (d) => d.komisi_kreator_raw ?? "—",
  },
  {
    label: "Komisi MEA",
    value: (d) => d.komisi_mea_pct,
    firstDir: "desc",
    cell: (d) => d.komisi_mea_raw ?? "—",
  },
  { label: "Ads Budget", value: (d) => d.ads_budget, firstDir: "desc", cell: (d) => formatRp(d.ads_budget) },
  { label: "Service Fee", value: (d) => d.service_fee, firstDir: "desc", cell: (d) => formatRp(d.service_fee) },
  {
    label: "Produk",
    value: (d) => d.productCount,
    firstDir: "desc",
    className: `${td} text-center`,
    cell: (d) => d.productCount,
  },
  { label: "Status", value: (d) => d.status, cell: (d) => d.status ?? "—" },
  {
    label: "Review",
    value: (d) => (d.review_flags ?? []).length,
    firstDir: "desc",
    cell: (d) => {
      const flags = d.review_flags ?? [];
      return flags.length > 0 ? (
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
          title={flags.join("; ")}
        >
          {flags.length} flag
        </span>
      ) : (
        "—"
      );
    },
  },
];

/**
 * Kolom yang bisa diklik untuk mengurutkan, diturunkan dari COLUMNS supaya definisi
 * kolom tetap satu sumber (label = kunci sort). `resettable`: klik ketiga kembali ke
 * urutan bawaan server (terbaru dulu), jadi user selalu bisa membatalkan pengurutan.
 */
const SORT: SortConfig<DealRow> = {
  columns: Object.fromEntries(
    COLUMNS.flatMap((c) =>
      c.value ? [[c.label, { value: c.value, firstDir: c.firstDir ?? "asc" }] as const] : []
    )
  ),
  resettable: true,
};

/**
 * Tabel Deal Brand: header bisa diklik untuk urut naik → turun → urutan bawaan,
 * paginasi 10 baris per halaman, plus tombol Edit per baris untuk yang punya izin
 * `deals.edit`.
 *
 * Pengurutan & paginasi client-side atas seluruh baris yang dikirim server (limit
 * 100) — klik header/halaman tidak memicu query Supabase baru. Perbandingan nilainya
 * memakai `useTableControls` bersama (sel kosong selalu di bawah, teks pakai collation
 * "id"), bukan comparator sendiri.
 *
 * Tabelnya lebar: badan tabel tetap bisa di-scroll kanan-kiri (kolom tidak dipaksa
 * melipat), sementara footer paginasi berada di luar area scroll supaya selalu terlihat.
 */
export function DealsTable({
  rows,
  canEdit,
  emptyMessage,
}: {
  rows: DealRow[];
  canEdit: boolean;
  /** Teks baris "kosong" — beda saat pencarian aktif vs daftar memang masih kosong. */
  emptyMessage: string;
}) {
  const controls = useTableControls<DealRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "deal",
  });

  const colCount = COLUMNS.length + (canEdit ? 1 : 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
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
              {canEdit && <th className={th}>Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                {COLUMNS.map((col) => (
                  <td key={col.label} className={col.className ?? td}>
                    {col.cell(d)}
                  </td>
                ))}
                {canEdit && (
                  <td className={td}>
                    <DealEditButton deal={d} />
                  </td>
                )}
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
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

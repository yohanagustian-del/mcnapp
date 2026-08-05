"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { sortRows, type SortDir, type SortValue } from "@/lib/utils/table-sort";
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

const td = "px-3 py-2";

interface TableColumn {
  /** Judul kolom — sekaligus kunci identitas kolom untuk state pengurutan. */
  label: string;
  /** Nilai pengurutan. Kolom tanpa `value` tidak bisa diklik (kolom aksi). */
  value?: (d: DealRow) => SortValue;
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
    className: "px-3 py-2 font-mono text-xs",
    cell: (d) => (
      <Link href={`/deals/${d.id}`} className="text-blue-700 underline">
        {d.id}
      </Link>
    ),
  },
  {
    label: "Brand",
    value: (d) => d.brand_name,
    className: "px-3 py-2 font-medium",
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
    cell: (d) => d.komisi_kreator_raw ?? "—",
  },
  {
    label: "Komisi MEA",
    value: (d) => d.komisi_mea_pct,
    cell: (d) => d.komisi_mea_raw ?? "—",
  },
  { label: "Ads Budget", value: (d) => d.ads_budget, cell: (d) => formatRp(d.ads_budget) },
  { label: "Service Fee", value: (d) => d.service_fee, cell: (d) => formatRp(d.service_fee) },
  {
    label: "Produk",
    value: (d) => d.productCount,
    className: "px-3 py-2 text-center",
    cell: (d) => d.productCount,
  },
  { label: "Status", value: (d) => d.status, cell: (d) => d.status ?? "—" },
  {
    label: "Review",
    value: (d) => (d.review_flags ?? []).length,
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
 * Tabel Deal Brand: header bisa diklik untuk urut naik/turun, plus tombol Edit
 * per baris untuk yang punya izin `deals.edit`.
 *
 * Pengurutan client-side atas seluruh baris yang dikirim server (limit 100) —
 * klik header tidak memicu query Supabase baru. Perbandingan nilainya memakai
 * `sortRows` bersama (sel kosong selalu di bawah, teks pakai collation "id"), bukan
 * comparator sendiri.
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
  // null = urutan bawaan dari server (terbaru dulu). Klik header: naik → turun →
  // kembali ke urutan bawaan, jadi user selalu bisa membatalkan pengurutan.
  const [sort, setSort] = useState<{ label: string; dir: SortDir } | null>(null);

  const toggleSort = useCallback((label: string) => {
    setSort((prev) => {
      if (prev?.label !== label) return { label, dir: "asc" };
      return prev.dir === "asc" ? { label, dir: "desc" } : null;
    });
  }, []);

  const sortedRows = useMemo(() => {
    const column = sort ? COLUMNS.find((c) => c.label === sort.label) : undefined;
    if (!sort || !column?.value) return rows;
    return sortRows(rows, column.value, sort.dir);
  }, [rows, sort]);

  const colCount = COLUMNS.length + (canEdit ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            {COLUMNS.map((col) => {
              const active = sort?.label === col.label;
              if (!col.value) return <th key={col.label} className="px-3 py-3">{col.label}</th>;
              return (
                <th
                  key={col.label}
                  className="px-3 py-3"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.label)}
                    title={
                      active && sort!.dir === "desc"
                        ? `Klik untuk kembali ke urutan bawaan (${col.label})`
                        : `Urutkan berdasarkan ${col.label}`
                    }
                    className={`flex w-full items-center gap-1 text-left uppercase hover:text-slate-800 ${
                      active ? "text-slate-800" : ""
                    }`}
                  >
                    <span>{col.label}</span>
                    <span
                      aria-hidden
                      className={`text-[10px] ${active ? "text-slate-700" : "text-slate-300"}`}
                    >
                      {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
            {canEdit && <th className="px-3 py-3">Aksi</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedRows.map((d) => (
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
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

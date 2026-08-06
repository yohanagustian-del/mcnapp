"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ColumnPicker, PAGE_SIZES_10_20_50_100, SortableTh, TablePagination,
  useColumnPreference, useTableControls,
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

/** Rupiah dipadatkan ("Rp1,2 jt") — nominal penuh tetap tersedia lewat title. */
function formatRpShort(v: number | null | undefined): ReactNode {
  if (!v) return "—";
  const n = Number(v);
  const short =
    n >= 1_000_000_000
      ? `Rp${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`
      : n >= 1_000_000
        ? `Rp${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`
        : `Rp${n.toLocaleString("id-ID")}`;
  return <span title={`Rp${n.toLocaleString("id-ID")}`}>{short}</span>;
}

// Padding dirapatkan (px-2) + font kecil: tujuannya tabel muat utuh di layar
// laptop pada preset "Ringkas", bukan dibaca sambil menggeser ke kanan-kiri.
const td = "px-2 py-2 whitespace-nowrap";
const th = "px-2 py-3 whitespace-nowrap";
/** Kolom teks bebas (brand/niche/status) dipotong, bukan melebarkan tabel. */
const tdTruncate = `${td} max-w-[13rem] truncate`;

interface TableColumn {
  /** Judul kolom — sekaligus kunci identitas kolom untuk state pengurutan & pilih kolom. */
  label: string;
  /** Ikut tampil pada preset "Ringkas" (tampilan awal, dipilih agar muat tanpa scroll). */
  compact?: boolean;
  /** Nilai pengurutan. Kolom tanpa `value` tidak bisa diklik (kolom aksi). */
  value?: (d: DealRow) => SortValue;
  /** Arah klik pertama — kolom angka mulai dari yang terbesar. Default "asc". */
  firstDir?: SortDir;
  cell: (d: DealRow) => ReactNode;
  className?: string;
}

/**
 * Definisi kolom — satu sumber untuk header, isi sel, pengurutan, dan menu Kolom,
 * jadi kolom baru tidak mungkin membuat header & isi bergeser.
 *
 * Komisi diurutkan pakai `komisi_*_pct` (angka hasil parse), BUKAN teks rawnya:
 * "5-7%" dan "10%" tidak punya urutan yang bermakna sebagai string.
 */
const COLUMNS: TableColumn[] = [
  {
    label: "Brand",
    compact: true,
    value: (d) => d.brand_name,
    className: `${tdTruncate} font-medium`,
    cell: (d) => (
      <>
        <Link href={`/deals/${d.id}`} className="hover:underline" title={`${d.brand_name} (${d.id})`}>
          {d.brand_name}
        </Link>
        {d.sourced_by_role === "cm" && (
          <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
            CM
          </span>
        )}
        {d.campaign_type && d.campaign_type !== "paid" && (
          <span className="ml-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">
            {d.campaign_type === "sample" ? "sample" : "komisi+"}
          </span>
        )}
      </>
    ),
  },
  {
    // ID tidak lagi tampil default: sel Brand sudah menautkan ke detail deal yang
    // sama, jadi kolom ini murni referensi — tetap tersedia lewat menu Kolom.
    label: "ID",
    value: (d) => d.id,
    className: `${td} font-mono text-xs`,
    cell: (d) => (
      <Link href={`/deals/${d.id}`} className="text-blue-700 underline">
        {d.id}
      </Link>
    ),
  },
  { label: "Shop ID", compact: true, value: (d) => d.shop_id, cell: (d) => d.shop_id ?? "—" },
  {
    label: "Niche",
    compact: true,
    value: (d) => d.niche,
    className: tdTruncate,
    cell: (d) => <span title={d.niche ?? undefined}>{d.niche ?? "—"}</span>,
  },
  // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
  { label: "Exp Date", compact: true, value: (d) => d.exp_date, cell: (d) => d.exp_date ?? "—" },
  {
    label: "Komisi Kreator",
    compact: true,
    value: (d) => d.komisi_kreator_pct,
    firstDir: "desc",
    cell: (d) => d.komisi_kreator_raw ?? "—",
  },
  {
    label: "Komisi MEA",
    compact: true,
    value: (d) => d.komisi_mea_pct,
    firstDir: "desc",
    cell: (d) => d.komisi_mea_raw ?? "—",
  },
  { label: "Ads Budget", value: (d) => d.ads_budget, firstDir: "desc", cell: (d) => formatRpShort(d.ads_budget) },
  { label: "Service Fee", value: (d) => d.service_fee, firstDir: "desc", cell: (d) => formatRpShort(d.service_fee) },
  { label: "GMV TAP", value: (d) => d.gmv_tap, firstDir: "desc", cell: (d) => formatRpShort(d.gmv_tap) },
  {
    label: "Campaign",
    value: (d) => d.campaign_name,
    className: tdTruncate,
    cell: (d) => <span title={d.campaign_name ?? undefined}>{d.campaign_name ?? "—"}</span>,
  },
  {
    label: "Produk",
    compact: true,
    value: (d) => d.productCount,
    firstDir: "desc",
    className: `${td} text-center`,
    cell: (d) => d.productCount,
  },
  { label: "Status", compact: true, value: (d) => d.status, cell: (d) => d.status ?? "—" },
  {
    label: "Review",
    compact: true,
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

const ALL_LABELS = COLUMNS.map((c) => c.label);
/** Preset "Ringkas": kolom harian saja, dipilih supaya tabel muat tanpa scroll horizontal. */
const COMPACT_LABELS = COLUMNS.filter((c) => c.compact).map((c) => c.label);
const COLUMN_PREF_KEY = "mcn.deals.columns.v1";

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
 * paginasi 10/20/50/100 baris, plus tombol Edit per baris untuk yang punya izin
 * `deals.edit`.
 *
 * Halaman ini sengaja TIDAK dirancang untuk digeser kanan-kiri. Sebelumnya semua
 * 13 kolom dipaksa tampil sekaligus sehingga tabel selalu lebih lebar dari layar;
 * sekarang defaultnya preset "Ringkas" (9 kolom + Aksi) dengan padding rapat dan
 * teks bebas yang dipotong, sementara kolom nominal (Ads Budget, Service Fee, GMV,
 * Campaign, ID) tinggal dicentang lewat menu Kolom saat memang dibutuhkan.
 *
 * Pengurutan & paginasi client-side atas seluruh baris yang dikirim server (limit
 * 100) — klik header/halaman tidak memicu query Supabase baru. Perbandingan nilainya
 * memakai `useTableControls` bersama (sel kosong selalu di bawah, teks pakai collation
 * "id"), bukan comparator sendiri.
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
    pageSizes: PAGE_SIZES_10_20_50_100,
    itemLabel: "deal",
  });

  const columnPref = useColumnPreference({
    storageKey: COLUMN_PREF_KEY,
    allLabels: ALL_LABELS,
    compactLabels: COMPACT_LABELS,
  });
  const visibleColumns = COLUMNS.filter((c) => columnPref.isShown(c.label));
  const colCount = visibleColumns.length + (canEdit ? 1 : 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <ColumnPicker pref={columnPref} allLabels={ALL_LABELS} />
        <span className="text-xs text-slate-400">
          Klik judul kolom untuk mengurutkan · pilihan kolom tersimpan di browser ini
        </span>
      </div>

      {/* Tetap disediakan sebagai jaring pengaman untuk layar sangat sempit /
          saat user mencentang semua kolom — bukan cara baca yang diharapkan. */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {visibleColumns.map((col) =>
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
                {visibleColumns.map((col) => (
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

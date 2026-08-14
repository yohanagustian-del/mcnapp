"use client";

import type { ReactNode } from "react";
import {
  ColumnPicker, PAGE_SIZES_10_20_50_100, SortableTh, TablePagination,
  useColumnPreference, useTableControls,
  type SortConfig, type SortDir, type SortValue,
} from "@/components/table-controls";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/deals/campaign-type";

/**
 * Satu SHOP hasil ringkasan kartu Produk TAP (view products_tap_shop_summary).
 *
 * Agregasinya dikerjakan SQL, bukan di sini: komponen ini hanya menampilkan,
 * mengurutkan, dan memaginasi baris yang sudah jadi.
 */
export interface ShopSummaryRow {
  /** Kunci grup: Shop Name, jatuh ke "#shop_id" saat namanya kosong. */
  shop_key: string;
  shop_name: string | null;
  shop_id: string | null;
  /** >1 = satu nama shop dipakai beberapa Shop ID (biasanya salah ketik saat input). */
  shop_id_count: number;
  product_count: number;
  active_count: number;
  needs_review_count: number;
  campaign_count: number;
  campaign_types: string[];
  ads_budget: number | null;
  service_fee: number | null;
  gmv_tap: number | null;
  avg_price: number | null;
  avg_commission_pct: number | null;
  avg_partner_commission_pct: number | null;
  effective_start: string | null;
  effective_end: string | null;
  /** Nama anggota tim hasil resolve server dari deal_by_ids / pic_tap_ids. */
  deal_by_names: string[];
  pic_tap_names: string[];
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
        : `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return <span title={`Rp${Math.round(n).toLocaleString("id-ID")}`}>{short}</span>;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Number(v).toFixed(1)}%`;
}

/** Daftar nama/label: dua pertama tampil, sisanya jadi "+n" dengan title lengkap. */
function nameList(values: string[]): ReactNode {
  if (values.length === 0) return "—";
  const shown = values.slice(0, 2).join(", ");
  return (
    <span title={values.join(", ")}>
      {shown}
      {values.length > 2 && <span className="text-slate-400"> +{values.length - 2}</span>}
    </span>
  );
}

// Kelas sel sengaja sama persis dengan tabel Deal Brand di sebelahnya: dua tabel
// di satu halaman yang padding & ukuran fontnya berbeda terbaca sebagai dua
// komponen asing, bukan dua sudut pandang atas data yang sama.
const td = "px-2 py-2 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "px-2 py-3 whitespace-nowrap";
const tdTruncate = `${td} max-w-[13rem] truncate`;

interface TableColumn {
  label: string;
  /** Ikut tampil pada preset "Ringkas" (tampilan awal, muat tanpa scroll). */
  compact?: boolean;
  value?: (s: ShopSummaryRow) => SortValue;
  firstDir?: SortDir;
  cell: (s: ShopSummaryRow) => ReactNode;
  className?: string;
}

const COLUMNS: TableColumn[] = [
  {
    label: "Shop Name",
    compact: true,
    value: (s) => s.shop_name ?? s.shop_key,
    className: `${tdTruncate} font-medium`,
    cell: (s) => (
      <span title={[s.shop_name ?? s.shop_key, s.shop_id].filter(Boolean).join(" · ")}>
        {s.shop_name ?? <span className="text-slate-400">{s.shop_key}</span>}
        {/* Nama shop yang menempel di beberapa Shop ID hampir selalu salah input —
            ditandai di sini supaya ketahuan tanpa membuka tab Produk TAP. */}
        {s.shop_id_count > 1 && (
          <span
            className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
            title={`${s.shop_id_count} Shop ID berbeda memakai nama shop ini`}
          >
            {s.shop_id_count} ID
          </span>
        )}
      </span>
    ),
  },
  {
    label: "Shop ID",
    compact: true,
    value: (s) => s.shop_id,
    className: `${td} font-mono text-xs`,
    cell: (s) => s.shop_id ?? "—",
  },
  {
    label: "Produk",
    compact: true,
    value: (s) => s.product_count,
    firstDir: "desc",
    className: `${td} text-center`,
    cell: (s) => (
      <span title={`${s.active_count} dari ${s.product_count} kartu berstatus aktif`}>
        {s.product_count}
      </span>
    ),
  },
  {
    label: "Campaign",
    compact: true,
    value: (s) => s.campaign_count,
    firstDir: "desc",
    className: `${td} text-center`,
    cell: (s) => s.campaign_count,
  },
  {
    label: "Tipe Campaign",
    compact: true,
    className: `${td} space-x-1`,
    // Satu shop bisa punya beberapa tipe sekaligus; diurutkan pakai tipe pertama
    // saja supaya kolomnya tetap bisa diklik.
    value: (s) => s.campaign_types[0] ?? null,
    cell: (s) =>
      s.campaign_types.length === 0
        ? "—"
        : s.campaign_types.map((t) => (
            <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {CAMPAIGN_TYPE_LABEL[t] ?? t}
            </span>
          )),
  },
  {
    label: "Komisi Kreator",
    compact: true,
    value: (s) => s.avg_commission_pct,
    firstDir: "desc",
    className: tdNum,
    cell: (s) => pct(s.avg_commission_pct),
  },
  {
    label: "Komisi Partner",
    value: (s) => s.avg_partner_commission_pct,
    firstDir: "desc",
    className: tdNum,
    cell: (s) => pct(s.avg_partner_commission_pct),
  },
  {
    label: "Ads Budget",
    value: (s) => s.ads_budget,
    firstDir: "desc",
    className: tdNum,
    cell: (s) => formatRpShort(s.ads_budget),
  },
  {
    label: "Service Fee",
    value: (s) => s.service_fee,
    firstDir: "desc",
    className: tdNum,
    cell: (s) => formatRpShort(s.service_fee),
  },
  {
    label: "GMV TAP",
    value: (s) => s.gmv_tap,
    firstDir: "desc",
    className: tdNum,
    cell: (s) => formatRpShort(s.gmv_tap),
  },
  {
    label: "Harga Rata-rata",
    value: (s) => s.avg_price,
    firstDir: "desc",
    className: tdNum,
    cell: (s) => formatRpShort(s.avg_price),
  },
  // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
  {
    label: "Exp Date",
    compact: true,
    value: (s) => s.effective_end,
    cell: (s) => (
      <span title={s.effective_start ? `Mulai ${s.effective_start}` : undefined}>
        {s.effective_end ?? "—"}
      </span>
    ),
  },
  {
    label: "Deal by",
    value: (s) => s.deal_by_names[0] ?? null,
    className: tdTruncate,
    cell: (s) => nameList(s.deal_by_names),
  },
  {
    label: "PIC TAP",
    value: (s) => s.pic_tap_names[0] ?? null,
    className: tdTruncate,
    cell: (s) => nameList(s.pic_tap_names),
  },
  {
    label: "Review",
    compact: true,
    value: (s) => s.needs_review_count,
    firstDir: "desc",
    cell: (s) =>
      s.needs_review_count > 0 ? (
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
          title="Kartu dengan harga / rate komisi yang belum bersih — perbaiki di tab Produk TAP"
        >
          {s.needs_review_count} kartu
        </span>
      ) : (
        "—"
      ),
  },
];

const ALL_LABELS = COLUMNS.map((c) => c.label);
const COMPACT_LABELS = COLUMNS.filter((c) => c.compact).map((c) => c.label);
const COLUMN_PREF_KEY = "mcn.deals.shops.columns.v1";

const SORT: SortConfig<ShopSummaryRow> = {
  columns: Object.fromEntries(
    COLUMNS.flatMap((c) =>
      c.value ? [[c.label, { value: c.value, firstDir: c.firstDir ?? "asc" }] as const] : []
    )
  ),
  resettable: true,
};

/**
 * Tabel "Shop dari Produk TAP" di tab Deal Brand.
 *
 * Isinya kolom yang sama dengan tabel Produk TAP, tapi DIRINGKAS per Shop Name:
 * satu baris per shop dengan jumlah kartu & campaign, total ads budget/service
 * fee/GMV, rata-rata harga & rate komisi, serta masa berlaku terjauh. Bentuk
 * barisnya sengaja sejajar dengan tabel Deal Brand (1 shop = 1 baris) supaya deal
 * baru (kartu produk) dan deal lama (brand_deals) bisa dibaca berdampingan.
 *
 * Perilakunya mengikuti tabel Deal Brand: preset kolom "Ringkas", klik header untuk
 * urut naik → turun → urutan bawaan, paginasi 10/20/50/100 — semuanya client-side
 * atas baris yang sudah diagregasi server.
 */
export function ShopsTable({
  rows,
  emptyMessage,
}: {
  rows: ShopSummaryRow[];
  emptyMessage: string;
}) {
  const controls = useTableControls<ShopSummaryRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_20_50_100,
    itemLabel: "shop",
  });

  const columnPref = useColumnPreference({
    storageKey: COLUMN_PREF_KEY,
    allLabels: ALL_LABELS,
    compactLabels: COMPACT_LABELS,
  });
  const visibleColumns = COLUMNS.filter((c) => columnPref.isShown(c.label));

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <ColumnPicker pref={columnPref} allLabels={ALL_LABELS} />
        <span className="text-xs text-slate-400">
          Klik judul kolom untuk mengurutkan · pilihan kolom tersimpan di browser ini
        </span>
      </div>

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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((s) => (
              <tr key={s.shop_key} className="hover:bg-slate-50">
                {visibleColumns.map((col) => (
                  <td key={col.label} className={col.className ?? td}>
                    {col.cell(s)}
                  </td>
                ))}
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-slate-400">
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

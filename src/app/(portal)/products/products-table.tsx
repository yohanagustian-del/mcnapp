"use client";

import type { ReactNode } from "react";
import {
  ColumnPicker, PAGE_SIZES_10_50_100, SortableTh, TableFilterBar, TablePagination,
  useColumnPreference, useTableControls,
  type SortConfig, type SortDir, type SortValue,
} from "@/components/table-controls";
import { ProductEditButton } from "./product-edit-button";

/** Satu baris katalog Produk TAP — master + metrik dari export Custom report. */
export interface ProductRow {
  product_id: string;
  product_name: string | null;
  shop_id: string | null;
  shop_name: string | null;
  level1_category: string | null;
  level2_category: string | null;
  price: number | null;
  price_segment: string | null;
  commission_pct: number | null;
  commission_note: string | null;
  partner_commission_pct: number | null;
  product_link: string | null;
  campaign_name: string | null;
  campaign_count: number | null;
  period_start: string | null;
  period_end: string | null;
  affiliate_gmv: number | null;
  affiliate_video_gmv: number | null;
  affiliate_live_gmv: number | null;
  settled_gmv: number | null;
  gmv_refund: number | null;
  revenue_showcase: number | null;
  orders: number | null;
  items_sold: number | null;
  collaborated_creators: number | null;
  creators_with_posts: number | null;
  creators_with_sales: number | null;
  est_partner_commission: number | null;
  actual_partner_commission: number | null;
  est_creator_commission: number | null;
  actual_creator_commission: number | null;
  link_gmv: number | null;
  link_items_sold: number | null;
  link_orders: number | null;
  source: string | null;
  active: boolean;
  needs_review: boolean;
  first_seen: string | null;
  last_seen: string | null;
}

export const SEGMENT_LABEL: Record<string, string> = {
  low: "Low (<180rb)",
  entry: "Entry (180rb-800rb)",
  sweet: "Sweet (800rb-3,6jt)",
  high: "High (3,6jt-8jt)",
  premium: "Premium (>8jt)",
};

/** Segmen dipendekkan di sel tabel; keterangan lengkapnya jadi tooltip. */
const SEGMENT_SHORT: Record<string, string> = {
  low: "Low", entry: "Entry", sweet: "Sweet", high: "High", premium: "Premium",
};

/** Rupiah dipadatkan ("Rp1,2 jt") supaya kolom nominal tidak melebarkan tabel. */
function rpShort(v: number | null): ReactNode {
  if (v == null) return "—";
  const n = Number(v);
  const short =
    Math.abs(n) >= 1_000_000_000
      ? `Rp${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`
      : Math.abs(n) >= 1_000_000
        ? `Rp${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`
        : `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return <span title={`Rp${Math.round(n).toLocaleString("id-ID")}`}>{short}</span>;
}

function count(v: number | null): string {
  return v == null ? "—" : Number(v).toLocaleString("id-ID");
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Number(v).toFixed(1)}%`;
}

const td = "px-2 py-2 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "px-2 py-3 whitespace-nowrap";

interface TableColumn {
  label: string;
  /** Ikut preset "Ringkas" (tampilan awal, dipilih agar muat tanpa scroll horizontal). */
  compact?: boolean;
  value?: (p: ProductRow) => SortValue;
  firstDir?: SortDir;
  cell: (p: ProductRow) => ReactNode;
  className?: string;
}

/**
 * Definisi kolom katalog — satu sumber untuk header, sel, pengurutan, dan menu Kolom.
 * Default kompak: Campaign ID, Product ID, Harga, Shop Name
 */
const COLUMNS: TableColumn[] = [
  {
    label: "Campaign ID",
    compact: true,
    value: (p) => p.campaign_name,
    className: `${td} max-w-[12rem] truncate font-mono text-xs`,
    cell: (p) => (
      <span title={p.campaign_name ?? undefined}>
        {p.campaign_name ?? "—"}
      </span>
    ),
  },
  {
    label: "Product ID",
    compact: true,
    value: (p) => p.product_id,
    className: `${td} max-w-[12rem] truncate font-mono text-xs`,
    cell: (p) => p.product_id,
  },
  {
    label: "Harga (Sale Price)",
    compact: true,
    value: (p) => p.price,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => rpShort(p.price),
  },
  {
    label: "Shop Name",
    compact: true,
    value: (p) => p.shop_name ?? p.shop_id,
    className: `${td} max-w-[10rem] truncate`,
    cell: (p) => <span title={p.shop_id ?? undefined}>{p.shop_name ?? p.shop_id ?? "—"}</span>,
  },
  {
    label: "Produk",
    value: (p) => p.product_name ?? p.product_id,
    className: `${td} max-w-[20rem] truncate font-medium`,
    cell: (p) => (
      <span title={`${p.product_name ?? "—"} · ${p.product_id}`}>
        {p.product_link ? (
          <a href={p.product_link} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {p.product_name ?? p.product_id}
          </a>
        ) : (
          (p.product_name ?? p.product_id)
        )}
      </span>
    ),
  },
  {
    label: "Kategori L2",
    value: (p) => p.level2_category,
    className: `${td} max-w-[11rem] truncate`,
    cell: (p) => (
      <span title={[p.level1_category, p.level2_category].filter(Boolean).join(" / ")}>
        {p.level2_category ?? p.level1_category ?? "—"}
      </span>
    ),
  },
  { label: "Kategori L1", value: (p) => p.level1_category, cell: (p) => p.level1_category ?? "—" },
  {
    label: "Segmen",
    value: (p) => p.price_segment,
    cell: (p) =>
      p.price_segment ? (
        <span title={SEGMENT_LABEL[p.price_segment] ?? p.price_segment}>
          {SEGMENT_SHORT[p.price_segment] ?? p.price_segment}
        </span>
      ) : (
        "—"
      ),
  },
  {
    label: "Affiliate GMV",
    value: (p) => p.affiliate_gmv,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => rpShort(p.affiliate_gmv),
  },
  {
    label: "% Live",
    value: (p) => (p.affiliate_gmv ? (p.affiliate_live_gmv ?? 0) / p.affiliate_gmv : null),
    firstDir: "desc",
    className: tdNum,
    cell: (p) =>
      p.affiliate_gmv
        ? `${(((p.affiliate_live_gmv ?? 0) / p.affiliate_gmv) * 100).toFixed(0)}%`
        : "—",
  },
  { label: "GMV Live", value: (p) => p.affiliate_live_gmv, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.affiliate_live_gmv) },
  { label: "GMV Video", value: (p) => p.affiliate_video_gmv, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.affiliate_video_gmv) },
  { label: "Settled GMV", value: (p) => p.settled_gmv, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.settled_gmv) },
  { label: "GMV Refund", value: (p) => p.gmv_refund, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.gmv_refund) },
  { label: "Revenue Showcase", value: (p) => p.revenue_showcase, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.revenue_showcase) },
  {
    label: "Items Sold",
    value: (p) => p.items_sold,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => count(p.items_sold),
  },
  { label: "Orders", value: (p) => p.orders, firstDir: "desc", className: tdNum, cell: (p) => count(p.orders) },
  {
    label: "Kreator",
    value: (p) => p.collaborated_creators,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => (
      <span
        title={`Kolaborasi ${count(p.collaborated_creators)} · posting ${count(
          p.creators_with_posts
        )} · ada penjualan ${count(p.creators_with_sales)}`}
      >
        {count(p.collaborated_creators)}
      </span>
    ),
  },
  { label: "Kreator Posting", value: (p) => p.creators_with_posts, firstDir: "desc", className: tdNum, cell: (p) => count(p.creators_with_posts) },
  { label: "Kreator Ada Sales", value: (p) => p.creators_with_sales, firstDir: "desc", className: tdNum, cell: (p) => count(p.creators_with_sales) },
  {
    label: "Komisi Kreator",
    value: (p) => p.commission_pct,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => (
      <>
        {pct(p.commission_pct)}
        {p.commission_note && (
          <span className="ml-1 text-xs text-amber-600" title={p.commission_note}>
            ⚠
          </span>
        )}
      </>
    ),
  },
  { label: "Komisi Partner", value: (p) => p.partner_commission_pct, firstDir: "desc", className: tdNum, cell: (p) => pct(p.partner_commission_pct) },
  { label: "Komisi Kreator (Rp)", value: (p) => p.actual_creator_commission ?? p.est_creator_commission, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.actual_creator_commission ?? p.est_creator_commission) },
  { label: "Komisi Partner (Rp)", value: (p) => p.actual_partner_commission ?? p.est_partner_commission, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.actual_partner_commission ?? p.est_partner_commission) },
  { label: "Link GMV", value: (p) => p.link_gmv, firstDir: "desc", className: tdNum, cell: (p) => rpShort(p.link_gmv) },
  { label: "Link Items", value: (p) => p.link_items_sold, firstDir: "desc", className: tdNum, cell: (p) => count(p.link_items_sold) },
  { label: "Link Orders", value: (p) => p.link_orders, firstDir: "desc", className: tdNum, cell: (p) => count(p.link_orders) },
  {
    label: "Campaign",
    value: (p) => p.campaign_name,
    className: `${td} max-w-[12rem] truncate`,
    cell: (p) => (
      <span title={p.campaign_name ?? undefined}>
        {p.campaign_name ?? "—"}
        {p.campaign_count && p.campaign_count > 1 && (
          <span className="ml-1 text-[10px] text-slate-400">+{p.campaign_count - 1}</span>
        )}
      </span>
    ),
  },
  {
    label: "Periode",
    value: (p) => p.period_start,
    cell: (p) => (p.period_start ? `${p.period_start} → ${p.period_end ?? "?"}` : "—"),
  },
  {
    label: "Sumber",
    value: (p) => p.source,
    cell: (p) => (
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          p.source === "master_upload" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
        }`}
      >
        {p.source === "master_upload" ? "Upload" : "Derive TAP"}
      </span>
    ),
  },
  {
    label: "Status",
    value: (p) => (p.needs_review ? 0 : p.active ? 2 : 1),
    cell: (p) => (
      <>
        {!p.active && <span className="text-xs text-red-600">nonaktif</span>}
        {p.needs_review && (
          <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            perlu review
          </span>
        )}
        {p.active && !p.needs_review && <span className="text-xs text-slate-400">ok</span>}
      </>
    ),
  },
  { label: "Terakhir Terlihat", value: (p) => p.last_seen, firstDir: "desc", cell: (p) => p.last_seen ?? "—" },
];

const ALL_LABELS = COLUMNS.map((c) => c.label);
const COMPACT_LABELS = COLUMNS.filter((c) => c.compact).map((c) => c.label);
const COLUMN_PREF_KEY = "mcn.products.columns.v1";

const SORT: SortConfig<ProductRow> = {
  columns: Object.fromEntries(
    COLUMNS.flatMap((c) =>
      c.value ? [[c.label, { value: c.value, firstDir: c.firstDir ?? "asc" }] as const] : []
    )
  ),
  resettable: true,
};

/**
 * Tabel katalog Produk TAP.
 *
 * Fitur:
 * - Pengurutan ascending/descending per kolom dengan klik header
 * - Paginasi 10/50/100 baris per halaman (client-side)
 * - Wild search untuk Campaign ID, Product ID, Shop Name, Product Name
 * - Pilih kolom yang ingin ditampilkan (default: Campaign ID, Product ID, Harga, Shop Name)
 * - Preset compact menyimpan pilihan kolom di localStorage
 */
export function ProductsTable({ rows, canEdit }: { rows: ProductRow[]; canEdit: boolean }) {
  const controls = useTableControls<ProductRow>({
    rows,
    searchText: (p) => `${p.product_name ?? ""} ${p.product_id} ${p.shop_name ?? ""} ${p.campaign_name ?? ""}`,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_50_100,
    itemLabel: "produk",
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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <TableFilterBar controls={controls} searchPlaceholder="Cari Campaign ID / Product ID / Shop Name / Product…" />
        <ColumnPicker pref={columnPref} allLabels={ALL_LABELS} />
        <span className="ml-auto text-xs text-slate-400">
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
              {canEdit && <th className={th}>Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((p) => (
              <tr key={p.product_id} className={p.needs_review ? "bg-amber-50" : "hover:bg-slate-50"}>
                {visibleColumns.map((col) => (
                  <td key={col.label} className={col.className ?? td}>
                    {col.cell(p)}
                  </td>
                ))}
                {canEdit && (
                  <td className={td}>
                    <ProductEditButton product={p} />
                  </td>
                )}
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
                  {controls.filterActive
                    ? "Tidak ada produk yang cocok dengan pencarian."
                    : "Belum ada produk TAP. Upload master list atau tunggu ingest mingguan."}
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

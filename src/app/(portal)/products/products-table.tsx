"use client";

import { useMemo, type ReactNode } from "react";
import {
  ColumnPicker, PAGE_SIZES_10_50_100, SortableTh, TableFilterBar, TablePagination,
  useColumnPreference, useTableControls,
  type SortConfig, type SortDir, type SortValue,
} from "@/components/table-controls";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/deals/campaign-type";
import { ProductEditButton } from "./product-edit-button";
import { CopyLinkButton } from "./copy-link-button";

/**
 * Satu baris katalog Produk TAP.
 *
 * Isinya sengaja dibatasi pada kolom yang benar-benar dipakai tabel, form edit,
 * dan wild search — metrik performa (GMV, orders, komisi nominal, dst.) tetap
 * tersimpan di `products_tap` tapi tidak ikut dikirim ke browser, karena tabel
 * ini hanya menampilkan atribut master dari export TAP "Export link".
 */
export interface ProductRow {
  product_id: string;
  product_name: string | null;
  shop_id: string | null;
  shop_name: string | null;
  level1_category: string | null;
  level2_category: string | null;
  price: number | null;
  commission_pct: number | null;
  commission_note: string | null;
  partner_commission_pct: number | null;
  creator_shop_ads_commission_pct: number | null;
  partner_shop_ads_commission_pct: number | null;
  product_link: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  effective_start: string | null;
  effective_end: string | null;
  /** Dimensi kartu deal (form Registrasi Deal) — tidak ada di export platform. */
  campaign_type: string | null;
  ads_budget: number | null;
  service_fee: number | null;
  deal_by: string | null;
  deal_by_name: string | null;
  pic_tap: string | null;
  pic_tap_name: string | null;
  source: string | null;
  active: boolean;
  needs_review: boolean;
  /** Pemilik baris: akun yang menginput (null = hasil derive ingest mingguan). */
  uploaded_by: string | null;
  /** Nama BD pemilik baris. Selalu null untuk role yang tidak boleh melihatnya. */
  uploader_name: string | null;
  uploader_team: string | null;
}

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

function pct(v: number | null): string {
  return v == null ? "—" : `${Number(v).toFixed(1)}%`;
}

const td = "px-2 py-2 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "px-2 py-3 whitespace-nowrap";

interface TableColumn {
  label: string;
  /**
   * Kolom yang membuka identitas pemilik data (Nama BD). Hanya dirender untuk role
   * BizDev ke atas — lihat izin `products.view_owner_name`.
   */
  ownerOnly?: boolean;
  /**
   * Kolom kartu deal (isian form Registrasi Deal), bukan kolom export TAP. Dipakai
   * memisahkan preset "Ringkas" = kolom yang persis ada di file export platform.
   */
  dealCard?: boolean;
  value?: (p: ProductRow) => SortValue;
  firstDir?: SortDir;
  cell: (p: ProductRow) => ReactNode;
  className?: string;
}

/**
 * Definisi kolom katalog — satu sumber untuk header, sel, pengurutan, dan menu Kolom.
 *
 * Isinya kolom export TAP "Export link" (nama & urutannya sengaja sama persis dengan
 * file export supaya baris di portal bisa dicocokkan langsung) + kolom kartu deal
 * dari form Registrasi Deal + Nama BD pemilik baris. Metrik performa tetap tidak
 * ditampilkan di tabel ini sama sekali.
 *
 * Semuanya tampil secara bawaan; menu "Kolom" dipakai untuk menyembunyikan yang
 * tidak diperlukan (preset "Ringkas" = kolom export TAP saja).
 */
const COLUMNS: TableColumn[] = [
  {
    label: "Campaign ID",
    value: (p) => p.campaign_id,
    className: `${td} font-mono text-[11px]`,
    cell: (p) => <span title={p.campaign_name ?? undefined}>{p.campaign_id ?? "—"}</span>,
  },
  {
    label: "Product Name",
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
    label: "Product ID",
    value: (p) => p.product_id,
    className: `${td} font-mono text-[11px]`,
    cell: (p) => p.product_id,
  },
  {
    label: "Sale Price",
    value: (p) => p.price,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => rpShort(p.price),
  },
  {
    label: "Shop Name",
    value: (p) => p.shop_name ?? p.shop_id,
    className: `${td} max-w-[14rem] truncate`,
    cell: (p) => <span title={p.shop_id ?? undefined}>{p.shop_name ?? p.shop_id ?? "—"}</span>,
  },
  {
    label: "Shop ID",
    dealCard: true,
    value: (p) => p.shop_id,
    className: `${td} font-mono text-[11px]`,
    cell: (p) => p.shop_id ?? "—",
  },
  {
    label: "Product Effective Start Time",
    value: (p) => p.effective_start,
    firstDir: "asc",
    cell: (p) => p.effective_start ?? "—",
  },
  {
    label: "Product Effective End Time",
    value: (p) => p.effective_end,
    firstDir: "asc",
    cell: (p) => p.effective_end ?? "—",
  },
  {
    label: "Creator Commission Rate",
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
  {
    label: "Affiliate Partner Commission Rate",
    value: (p) => p.partner_commission_pct,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => pct(p.partner_commission_pct),
  },
  {
    label: "Creator Shop Ads Commission Rate",
    value: (p) => p.creator_shop_ads_commission_pct,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => pct(p.creator_shop_ads_commission_pct),
  },
  {
    label: "Affiliate Partner Shop Ads Commission Rate",
    value: (p) => p.partner_shop_ads_commission_pct,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => pct(p.partner_shop_ads_commission_pct),
  },
  {
    label: "Product Link",
    value: (p) => p.product_link,
    className: `${td} text-center`,
    cell: (p) =>
      p.product_link ? (
        <span className="inline-flex items-center gap-1.5">
          <a
            href={p.product_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            buka
          </a>
          <CopyLinkButton url={p.product_link} label={p.product_name ?? p.product_id} />
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
  {
    label: "Tipe Campaign",
    dealCard: true,
    value: (p) => p.campaign_type,
    cell: (p) =>
      p.campaign_type ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {CAMPAIGN_TYPE_LABEL[p.campaign_type] ?? p.campaign_type}
        </span>
      ) : (
        "—"
      ),
  },
  {
    label: "Ads Budget",
    dealCard: true,
    value: (p) => p.ads_budget,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => rpShort(p.ads_budget),
  },
  {
    label: "Service Fee",
    dealCard: true,
    value: (p) => p.service_fee,
    firstDir: "desc",
    className: tdNum,
    cell: (p) => rpShort(p.service_fee),
  },
  {
    // Yang menutup deal (CM/BizDev) — beda dari Nama BD (akun yang menginput baris).
    label: "Deal by",
    dealCard: true,
    value: (p) => p.deal_by_name,
    className: `${td} max-w-[12rem] truncate`,
    cell: (p) => p.deal_by_name ?? "—",
  },
  {
    label: "PIC TAP",
    dealCard: true,
    value: (p) => p.pic_tap_name,
    className: `${td} max-w-[12rem] truncate`,
    cell: (p) => p.pic_tap_name ?? "—",
  },
  {
    // Nama BD pemilik baris — akun yang menginput campaign ini.
    label: "Nama BD",
    ownerOnly: true,
    value: (p) => p.uploader_name,
    className: `${td} max-w-[12rem] truncate`,
    cell: (p) => {
      if (p.uploader_name) {
        return (
          <span title={[p.uploader_name, p.uploader_team].filter(Boolean).join(" · ")}>
            {p.uploader_name}
          </span>
        );
      }
      // Tanpa pemilik ada dua sebab yang berbeda artinya, jadi jangan disamakan:
      // baris derive memang tidak pernah punya peng-upload, sedangkan baris
      // master_upload lama diunggah sebelum kolom kepemilikan ada.
      return p.source === "derived_tap" ? (
        <span className="text-slate-400" title="Hasil derive ingest mingguan, bukan upload manual">
          ingest
        </span>
      ) : (
        <span
          className="text-slate-400"
          title="Diunggah sebelum kepemilikan dicatat — akan terisi saat campaign ini di-upload ulang"
        >
          belum tercatat
        </span>
      );
    },
  },
];

// Preset "Ringkas" = persis kolom yang ada di file export TAP "Export link".
const COMPACT_LABELS = COLUMNS.filter((c) => !c.dealCard && !c.ownerOnly).map((c) => c.label);
// Kunci dinaikkan tiap daftar kolom berubah — kalau tidak, browser yang sudah pernah
// membuka halaman ini memulihkan pilihan lama dan kolom baru tidak pernah muncul.
const COLUMN_PREF_KEY = "mcn.products.columns.v4";

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
 * - Klik header untuk mengurutkan: naik → turun → urutan bawaan server.
 * - Paginasi 10/50/100 baris per halaman.
 * - Wild search satu kotak: Campaign ID, Product ID, Shop Name, Product Name.
 * - Menu "Kolom": semua kolom tampil secara bawaan dan bisa disembunyikan satu per
 *   satu; pilihannya tersimpan di localStorage browser masing-masing.
 *
 * Kolom Nama BD hanya ada untuk role BizDev ke atas (`canSeeOwner`, sudah
 * divalidasi di server — namanya tidak ikut dikirim untuk role lain), jadi ia juga
 * tidak muncul di menu Kolom mereka.
 *
 * Pengurutan/paginasi/pencarian semuanya client-side atas baris yang sudah
 * dikirim server — mengetik atau klik header tidak memicu query Supabase baru.
 */
export function ProductsTable({
  rows,
  canEdit,
  canSeeOwner,
}: {
  rows: ProductRow[];
  canEdit: boolean;
  canSeeOwner: boolean;
}) {
  const controls = useTableControls<ProductRow>({
    rows,
    // Wild search satu kotak: campaign id, product id, shop name, product name.
    // uploader_name ikut hanya kalau role memang boleh melihatnya — untuk role
    // lain nilainya sudah null dari server, jadi tidak bisa ditebak lewat search.
    searchText: (p) =>
      `${p.campaign_id ?? ""} ${p.product_id} ${p.shop_name ?? ""} ${p.product_name ?? ""} ${p.shop_id ?? ""} ${p.campaign_name ?? ""} ${p.uploader_name ?? ""}`,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_50_100,
    itemLabel: "produk",
  });

  // Kolom yang boleh dilihat role ini; kolom Nama BD tidak sekadar disembunyikan,
  // ia tidak masuk daftar pilihan sama sekali.
  const allowedColumns = useMemo(
    () => COLUMNS.filter((c) => !c.ownerOnly || canSeeOwner),
    [canSeeOwner]
  );
  const allLabels = useMemo(() => allowedColumns.map((c) => c.label), [allowedColumns]);
  const compactLabels = useMemo(
    () => COMPACT_LABELS.filter((l) => allLabels.includes(l)),
    [allLabels]
  );

  const columnPref = useColumnPreference({
    storageKey: COLUMN_PREF_KEY,
    allLabels,
    compactLabels,
    // Bawaannya SEMUA kolom: kolom kartu deal (tipe campaign, budget, deal by, PIC)
    // baru ada gunanya kalau langsung kelihatan. "Ringkas" tetap tersedia di menu.
    defaultLabels: allLabels,
  });
  const visibleColumns = allowedColumns.filter((c) => columnPref.isShown(c.label));
  const colCount = visibleColumns.length + (canEdit ? 1 : 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <TableFilterBar
          controls={controls}
          searchPlaceholder="Cari Campaign ID / Product ID / Shop Name / Product Name…"
        />
        <ColumnPicker pref={columnPref} allLabels={allLabels} />
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
              // Kunci baris ikut campaign: satu product_id bisa muncul di beberapa
              // campaign, jadi product_id saja akan bentrok sebagai React key.
              <tr
                key={`${p.campaign_id ?? "-"}|${p.product_id}`}
                className={p.needs_review ? "bg-amber-50" : "hover:bg-slate-50"}
              >
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

"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import {
  PAGE_SIZES_10_20_50, SortableTh, TableFilterBar, TablePagination, useTableControls,
  type FacetDef, type SortConfig, type SortDir, type SortValue,
} from "@/components/table-controls";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/deals/campaign-type";
import { productRowKey } from "@/lib/m10/product-keys";
import { setProjectProducts } from "../actions";
import type { ProjectFormState } from "../actions";

/** Satu kartu produk milik shop-shop project (baris products_tap apa adanya). */
export interface ProjectProductRow {
  campaign_id: string;
  product_id: string;
  product_name: string | null;
  product_link: string | null;
  shop_name: string | null;
  price: number | null;
  commission_pct: number | null;
  partner_commission_pct: number | null;
  campaign_type: string | null;
  ads_budget: number | null;
  service_fee: number | null;
  effective_end: string | null;
  needs_review: boolean;
  /** Sudah ditandai dikerjasamakan pada project ini (bd_project_products). */
  selected: boolean;
}

function formatRp(v: number | null): string {
  return v ? `Rp${Math.round(Number(v)).toLocaleString("id-ID")}` : "—";
}

const td = "px-3 py-2";
const th = "px-3 py-3 whitespace-nowrap";

interface Column {
  key: string;
  label: string;
  value: (p: ProjectProductRow) => SortValue;
  firstDir?: SortDir;
  className?: string;
  cell: (p: ProjectProductRow) => ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: "product_id",
    label: "Product ID",
    value: (p) => p.product_id,
    className: `${td} font-mono text-xs`,
    cell: (p) => p.product_id,
  },
  {
    key: "nama",
    label: "Nama Produk",
    value: (p) => p.product_name ?? p.product_id,
    className: `${td} max-w-[20rem] truncate font-medium`,
    cell: (p) => (
      <span title={p.product_name ?? p.product_id}>
        {p.product_name ?? "—"}
        {p.needs_review && (
          <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
            review
          </span>
        )}
      </span>
    ),
  },
  {
    key: "shop",
    label: "Shop",
    value: (p) => p.shop_name,
    className: `${td} max-w-[12rem] truncate`,
    cell: (p) => p.shop_name ?? "—",
  },
  {
    key: "link",
    label: "Link",
    value: (p) => p.product_link,
    cell: (p) =>
      p.product_link ? (
        <a
          href={p.product_link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline"
        >
          buka ↗
        </a>
      ) : (
        "—"
      ),
  },
  { key: "harga", label: "Harga", value: (p) => p.price, firstDir: "desc", cell: (p) => formatRp(p.price) },
  {
    key: "komisi",
    label: "Komisi Kreator",
    value: (p) => p.commission_pct,
    firstDir: "desc",
    cell: (p) => (p.commission_pct != null ? `${Number(p.commission_pct)}%` : "—"),
  },
  {
    key: "komisi_partner",
    label: "Komisi Partner",
    value: (p) => p.partner_commission_pct,
    firstDir: "desc",
    cell: (p) => (p.partner_commission_pct != null ? `${Number(p.partner_commission_pct)}%` : "—"),
  },
  {
    key: "tipe",
    label: "Tipe Campaign",
    value: (p) => p.campaign_type,
    cell: (p) => CAMPAIGN_TYPE_LABEL[p.campaign_type ?? ""] ?? "—",
  },
  { key: "ads", label: "Ads Budget", value: (p) => p.ads_budget, firstDir: "desc", cell: (p) => formatRp(p.ads_budget) },
  { key: "fee", label: "Service Fee", value: (p) => p.service_fee, firstDir: "desc", cell: (p) => formatRp(p.service_fee) },
  { key: "exp", label: "Exp Date", value: (p) => p.effective_end, cell: (p) => p.effective_end ?? "—" },
];

const SORT: SortConfig<ProjectProductRow> = {
  columns: Object.fromEntries(
    COLUMNS.map((c) => [c.key, { value: c.value, firstDir: c.firstDir ?? "asc" }] as const)
  ),
  resettable: true,
};

/** Wild search: nama produk lebih dulu (yang diminta), plus ID & shop supaya satu kotak cukup. */
const searchText = (p: ProjectProductRow) =>
  `${p.product_name ?? ""} ${p.product_id} ${p.shop_name ?? ""} ${p.campaign_id}`;

/**
 * Tabel "Produk yang Dikerjasamakan" pada detail Project BD.
 *
 * Isinya SELURUH kartu produk milik shop-shop project — satu shop bisa punya
 * ratusan kartu sementara yang benar-benar digarap hanya sebagian, jadi kartu yang
 * masuk kerja sama DICENTANG dan disimpan sebagai kunci (campaign_id, product_id)
 * di bd_project_products. Atribut produknya tetap dibaca dari products_tap, tidak
 * pernah disalin ke project (CLAUDE.md #4).
 *
 * Fitur: centang per baris (+ centang sehalaman), search nama produk, klik header
 * untuk mengurutkan (naik → turun → bawaan), filter status kerja sama, dan paginasi
 * 10/20/50. Semuanya client-side atas baris yang sudah dikirim server; pilihan
 * disimpan sebagai KUNCI, bukan indeks baris, jadi bertahan lintas halaman & sort.
 */
export function ProjectProductsTable({
  projectId,
  rows,
  canManage,
}: {
  projectId: string;
  rows: ProjectProductRow[];
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState<ProjectFormState | null, FormData>(
    setProjectProducts,
    null
  );

  // Keadaan awal = apa yang tersimpan di database; perubahan baru berlaku setelah
  // tombol Simpan ditekan (satu tulis untuk seluruh daftar, bukan per centangan).
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(rows.filter((r) => r.selected).map((r) => productRowKey(r.campaign_id, r.product_id)))
  );
  const savedKeys = useMemo(
    () =>
      new Set(
        rows.filter((r) => r.selected).map((r) => productRowKey(r.campaign_id, r.product_id))
      ),
    [rows]
  );
  const dirty =
    selected.size !== savedKeys.size || [...selected].some((k) => !savedKeys.has(k));

  const facets = useMemo<FacetDef<ProjectProductRow>[]>(
    () => [
      {
        key: "kerjasama",
        label: "Status kerja sama",
        // Nilainya dibaca dari keadaan TERSIMPAN (bukan centangan yang belum
        // disimpan), supaya barisnya tidak melompat keluar filter saat dicentang.
        value: (p) =>
          p.selected
            ? { value: "ya", label: "Dikerjasamakan" }
            : { value: "belum", label: "Belum dipilih" },
      },
    ],
    []
  );

  const controls = useTableControls<ProjectProductRow>({
    rows,
    searchText,
    facets,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_20_50,
    itemLabel: "produk",
  });

  const pageKeys = controls.visibleRows.map((p) => productRowKey(p.campaign_id, p.product_id));
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      // Semua baris halaman ini sudah tercentang → klik berikutnya melepas halaman
      // ini saja; pilihan di halaman lain tidak ikut hilang.
      for (const k of pageKeys) {
        if (allPageSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  const colCount = COLUMNS.length + (canManage ? 1 : 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {canManage && (
        <form
          action={formAction}
          className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-2"
        >
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="product_keys" value={JSON.stringify([...selected])} />
          <span className="text-sm text-slate-600">
            <strong>{selected.size}</strong> dari {rows.length} kartu ditandai dikerjasamakan
          </span>
          <button
            type="submit"
            disabled={pending || !dirty}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {pending ? "Menyimpan…" : "Simpan pilihan"}
          </button>
          {dirty && !pending && (
            <button
              type="button"
              onClick={() => setSelected(savedKeys)}
              className="rounded-md px-2 py-1 text-xs text-slate-500 underline hover:text-slate-800"
            >
              Batalkan perubahan
            </button>
          )}
          {state && (
            <span className={`text-xs ${state.ok ? "text-green-700" : "text-red-600"}`}>
              {state.message}
            </span>
          )}
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <TableFilterBar controls={controls} searchPlaceholder="Cari nama produk / Product ID / shop…" />
        <span className="ml-auto text-xs text-slate-400">
          Klik judul kolom untuk mengurutkan
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {canManage && (
                <th className={`${th} w-8`}>
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePage}
                    aria-label="Pilih semua produk di halaman ini"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
              )}
              {COLUMNS.map((c) => (
                <SortableTh key={c.key} controls={controls} sortKey={c.key} className={th}>
                  {c.label}
                </SortableTh>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((p) => {
              const key = productRowKey(p.campaign_id, p.product_id);
              const checked = selected.has(key);
              return (
                <tr key={key} className={checked ? "bg-blue-50" : "hover:bg-slate-50"}>
                  {canManage && (
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRow(key)}
                        aria-label={`Kerjasamakan ${p.product_name ?? p.product_id}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                  )}
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={c.className ?? td}>
                      {c.cell(p)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
                  {controls.filterActive
                    ? "Tidak ada produk yang cocok dengan pencarian / filter."
                    : "Belum ada kartu produk untuk shop project ini. Daftarkan lewat Registrasi Deal atau upload master product list."}
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

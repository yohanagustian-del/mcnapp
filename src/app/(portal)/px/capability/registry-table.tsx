"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  PAGE_SIZES_10_20_50_100, SortableTh, TableFilterBar, TablePagination, useTableControls,
  type SortConfig,
} from "@/components/table-controls";
import { capabilityRowKey, type CapabilityRow } from "@/lib/px/capability-data";
import { bulkSetCapabilitySlots, type CapabilityBulkState } from "./actions";

const PRICE_SEGMENT_LABEL: Record<string, string> = {
  low: "Low (<180rb)", entry: "Entry (180rb–800rb)", sweet: "Sweet spot (800rb–3,6jt)",
  high: "High (3,6jt–8jt)", premium: "Premium (>8jt)",
};

function rpShort(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

const td = "px-3 py-2 whitespace-nowrap text-sm";
const th = "px-3 py-3 whitespace-nowrap text-xs font-semibold text-slate-500";

/**
 * Tab Registry: DUA hal yang tampak seperti dua fitur tapi sebetulnya satu
 * mekanisme — sort/filter/paginasi lewat infra bersama (useTableControls dkk,
 * WAJIB, tidak ada implementasi kedua) DAN edit massal (surat tugas Langkah 6).
 *
 * Edit massal di sini SENGAJA beda bentuk dari BulkActionBar produk (yang
 * menerapkan SATU nilai sama ke banyak baris terpilih): slots_total secara
 * bisnis berbeda per (kreator, kategori, segmen) — menyeragamkan nilainya lewat
 * satu input akan salah untuk kasus nyata (kreator A pantas 5 slot, kreator B
 * cuma 1). Jadi tiap baris punya input Slot Total sendiri; baris yang nilainya
 * diubah dari semula ditandai "dirty" dan SEMUA baris dirty (bisa lintas
 * halaman/sort) disimpan dalam SATU submit — itulah "bulk ≥50 baris sekali
 * simpan" di sini. Di server (actions.ts), penyimpanan tetap SATU panggilan
 * RPC yang menulis semua baris sekaligus di Postgres (bukan loop per baris dari
 * JS) — mengikuti semangat "kelompokkan, jangan loop per baris" dari
 * bulkUpdateProducts, hanya saja pengelompokannya terjadi di dalam SQL (temp
 * table + UPDATE ber-JOIN) karena kunci barisnya 3 kolom, bukan 1.
 */
export function CapabilityRegistryTable({
  rows,
  canWrite,
  limitHit,
}: {
  rows: CapabilityRow[];
  canWrite: boolean;
  limitHit: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [state, formAction, pending] = useActionState<CapabilityBulkState, FormData>(
    bulkSetCapabilitySlots,
    null
  );

  useEffect(() => {
    if (state?.ok) setEdits({});
  }, [state]);

  const sort: SortConfig<CapabilityRow> = useMemo(
    () => ({
      columns: {
        creator: { value: (r) => (r.creatorName ?? r.creatorId).toLowerCase() },
        level2: { value: (r) => r.level2Category.toLowerCase() },
        segment: { value: (r) => r.priceSegment },
        proven_gmv: { value: (r) => r.provenGmv, firstDir: "desc" },
        proven_orders: { value: (r) => r.provenOrders, firstDir: "desc" },
        slots_total: { value: (r) => r.slotsTotal, firstDir: "desc" },
        slots_available: { value: (r) => r.slotsAvailable, firstDir: "desc" },
        last_computed: { value: (r) => r.lastComputedAt, firstDir: "desc" },
      },
      initial: { key: "proven_gmv", dir: "desc" },
    }),
    []
  );

  const controls = useTableControls({
    rows,
    searchText: (r) => `${r.creatorName ?? ""} ${r.creatorUsername ?? ""} ${r.level2Category}`,
    facets: [
      { key: "level2", label: "Kategori", value: (r) => ({ value: r.level2Category, label: r.level2Category }) },
      {
        key: "segment", label: "Segmen",
        value: (r) => ({ value: r.priceSegment, label: PRICE_SEGMENT_LABEL[r.priceSegment] ?? r.priceSegment }),
      },
    ],
    sort,
    pageSizes: PAGE_SIZES_10_20_50_100,
    itemLabel: "baris kapasitas",
  });

  const dirtyKeys = Object.keys(edits);
  const dirtyCount = dirtyKeys.length;

  function setEdit(row: CapabilityRow, raw: string) {
    const key = capabilityRowKey(row.creatorId, row.level2Category, row.priceSegment);
    if (raw.trim() === "") {
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setEdits((prev) => {
      if (n === row.slotsTotal) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: n };
    });
  }

  const rowsByKey = useMemo(
    () => new Map(rows.map((r) => [capabilityRowKey(r.creatorId, r.level2Category, r.priceSegment), r])),
    [rows]
  );
  const updatesPayload = JSON.stringify(
    dirtyKeys.map((key) => {
      const r = rowsByKey.get(key)!;
      return {
        creatorId: r.creatorId, level2Category: r.level2Category, priceSegment: r.priceSegment,
        slotsTotal: edits[key],
      };
    })
  );

  return (
    <div>
      {limitHit && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Daftar dibatasi ke baris teratas — cari kategori/kreator spesifik lewat filter di bawah kalau
          barisnya tidak terlihat.
        </p>
      )}

      <TableFilterBar controls={controls} searchPlaceholder="Cari kreator / kategori…" className="mb-3" />

      {canWrite && dirtyCount > 0 && (
        <form
          action={formAction}
          className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2"
        >
          <input type="hidden" name="updates" value={updatesPayload} />
          <span className="text-sm font-medium text-slate-700">{dirtyCount} baris diubah</span>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Menyimpan…" : `Simpan ${dirtyCount} perubahan`}
          </button>
          <button
            type="button"
            onClick={() => setEdits({})}
            className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Batal
          </button>
        </form>
      )}
      {state && !state.ok && (
        <p className="mb-3 whitespace-pre-line rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {state.message}
        </p>
      )}
      {state?.ok && (
        <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          {state.message}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <SortableTh controls={controls} sortKey="creator" className={th}>Kreator</SortableTh>
              <SortableTh controls={controls} sortKey="level2" className={th}>Kategori</SortableTh>
              <SortableTh controls={controls} sortKey="segment" className={th}>Segmen Harga</SortableTh>
              <SortableTh controls={controls} sortKey="proven_gmv" className={th}>Proven GMV</SortableTh>
              <SortableTh controls={controls} sortKey="proven_orders" className={th}>Proven Orders</SortableTh>
              <SortableTh controls={controls} sortKey="last_computed" className={th}>Terakhir dihitung</SortableTh>
              <SortableTh controls={controls} sortKey="slots_total" className={th}>Slot Total</SortableTh>
              <th className={th}>Slot Terisi</th>
              <SortableTh controls={controls} sortKey="slots_available" className={th}>Slot Tersedia</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => {
              const key = capabilityRowKey(r.creatorId, r.level2Category, r.priceSegment);
              const dirty = key in edits;
              return (
                <tr key={key} className={dirty ? "bg-amber-50" : undefined}>
                  <td className={td}>
                    <div className="font-medium text-slate-800">{r.creatorName ?? r.creatorId}</div>
                    <div className="text-xs text-slate-400">@{r.creatorUsername ?? "—"}</div>
                  </td>
                  <td className={td}>{r.level2Category}</td>
                  <td className={td}>{PRICE_SEGMENT_LABEL[r.priceSegment] ?? r.priceSegment}</td>
                  <td className={`${td} text-right tabular-nums`}>{rpShort(r.provenGmv)}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.provenOrders.toLocaleString("id-ID")}</td>
                  <td className={td}>{new Date(r.lastComputedAt).toLocaleDateString("id-ID")}</td>
                  <td className={td}>
                    {canWrite ? (
                      <input
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={r.slotsTotal}
                        onChange={(e) => setEdit(r, e.target.value)}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                      />
                    ) : (
                      <span className="tabular-nums">{r.slotsTotal}</span>
                    )}
                  </td>
                  <td className={`${td} text-right tabular-nums text-slate-500`} title="Belum ada sumbernya sampai M5 (px_match) lahir — selalu 0 hari ini.">
                    {r.slotsCommitted}
                  </td>
                  <td className={`${td} text-right tabular-nums font-medium`}>{r.slotsAvailable}</td>
                </tr>
              );
            })}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">
                  Tidak ada baris kapasitas yang cocok dengan filter ini.
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

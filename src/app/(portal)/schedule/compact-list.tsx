"use client";

import { useMemo } from "react";
import Link from "next/link";
import { slotFlags } from "@/lib/schedule/indicators";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import {
  PAGE_SIZE_10, SortableTh, TableFilterBar, TablePagination, useTableControls,
  type FacetDef, type FacetOption, type SortConfig,
} from "@/components/table-controls";

/** Row shape shared by the compact read-only schedule lists in workspace CM/BizDev. */
export interface CompactSlotRow {
  slot: LiveScheduleSlot;
  creatorName: string;
  /** Dipakai search "username kreator" (opsional — kalau null, baris tidak cocok saat search). */
  creatorUsername?: string | null;
  /** Dipakai filter CM (opsional — tanpa ini filter CM tidak dirender). */
  ownerCpmId?: string | null;
  cmName?: string | null;
}

function timeRange(slot: LiveScheduleSlot): string {
  if (slot.status === "off") return `OFF${slot.off_reason ? ` — ${slot.off_reason}` : ""}`;
  if (slot.start_time && slot.end_time) return `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
  return "—";
}

/**
 * Teks yang dicocokkan search box: kreator (nama + username), brand, tanggal, dan
 * jam — satu kotak untuk keempat kolom, jadi "scarlett", "19:00", atau "2026-08-07"
 * sama-sama menyaring daftar.
 */
const searchRowText = (r: CompactSlotRow) =>
  [
    r.creatorName,
    r.creatorUsername ?? "",
    r.slot.status === "off" ? "" : r.slot.brand_name?.trim() || "Organik",
    r.slot.schedule_date,
    timeRange(r.slot),
    r.slot.ads_note ?? "",
  ].join(" ");

const rowCm = (r: CompactSlotRow) => ({ id: r.ownerCpmId ?? null, name: r.cmName ?? null });

/**
 * Kolom yang bisa diurutkan lewat klik header. Tanggal memakai tanggal + jam mulai
 * sebagai satu nilai supaya hari yang sama tetap urut jamnya.
 */
const SORT: SortConfig<CompactSlotRow> = {
  columns: {
    tanggal: { value: (r) => `${r.slot.schedule_date} ${r.slot.start_time ?? ""}` },
    kreator: { value: (r) => r.creatorName },
    brand: { value: (r) => (r.slot.status === "off" ? null : r.slot.brand_name?.trim() || "Organik") },
    jam: { value: (r) => r.slot.start_time },
    // Catatan ads ditulis bebas ("Rp500rb", "invoicing MEA"); diurutkan sebagai
    // teks, slot tanpa catatan (null) selalu jatuh ke bawah lewat sortRows.
    catatan_ads: { value: (r) => r.slot.ads_note?.trim() || null },
    status: { value: (r) => r.slot.status },
  },
  // Default = urutan yang dipakai server (tanggal menaik).
  initial: { key: "tanggal", dir: "asc" },
};

/** Nilai facet "Brand" — slot OFF tidak punya brand; slot tanpa brand = Organik. */
const ORGANIK_VALUE = "__organik__";
function slotBrand(r: CompactSlotRow): FacetOption | null {
  if (r.slot.status === "off") return null;
  const brand = r.slot.brand_name?.trim();
  // Nama brand dinormalkan ke huruf kecil sebagai nilai filter supaya "Scarlett" dan
  // "scarlett" dari dua input tidak jadi dua opsi berbeda; label pakai ejaan aslinya.
  return brand ? { value: brand.toLowerCase(), label: brand } : { value: ORGANIK_VALUE, label: "Organik" };
}

/** Nilai facet "Jam" — dibucket per jam mulai (HH), slot OFF/tanpa jam tidak punya nilai. */
function slotHour(r: CompactSlotRow): FacetOption | null {
  if (r.slot.status === "off" || !r.slot.start_time) return null;
  const hh = r.slot.start_time.slice(0, 2);
  return { value: hh, label: `${hh}:00–${hh}:59` };
}

/**
 * Read-only compact schedule table for workspace pages (CM / BizDev). Reuses
 * src/lib/schedule/indicators.ts for the PK/TAP/tentative/verification badges — no
 * logic duplicated. Always links out to /schedule for the full editable calendar.
 *
 * Header tiap kolom bisa diklik untuk urut naik/turun dan paginasi 10 baris per
 * halaman selalu aktif. `searchable` (BizDev Workspace) menambah search box kreator /
 * brand / tanggal / jam; `filterable` (CM Workspace) menambah search box yang sama plus
 * filter multi-select CM, Brand, Tanggal, dan Jam. Semua client-side — daftar sudah
 * dimuat server, jadi memfilter tidak memicu query Supabase baru.
 */
export function CompactScheduleList({
  title,
  rows,
  todayIso,
  emptyLabel,
  filterable = false,
  searchable = false,
  showAdsNote = false,
}: {
  title: string;
  rows: CompactSlotRow[];
  todayIso: string;
  emptyLabel: string;
  filterable?: boolean;
  /** Search box tanpa filter multi-select. Implisit aktif kalau `filterable`. */
  searchable?: boolean;
  /**
   * Tampilkan kolom "Catatan Ads" (live_schedule_slots.ads_note — nominal /
   * detail ads yang diisi di form slot). Dipakai CM Workspace; BizDev memakai
   * daftar yang sama tanpa kolom ini supaya tabelnya tetap ringkas.
   */
  showAdsNote?: boolean;
}) {
  // Opsi tanggal butuh todayIso untuk penanda "hari ini", jadi facet dibangun di sini
  // (dan di-memo — useTableControls memakai referensinya sebagai dependency).
  const facets = useMemo<FacetDef<CompactSlotRow>[] | undefined>(() => {
    if (!filterable) return undefined;
    return [
      { key: "brand", label: "Brand", value: slotBrand, emptyLabel: "Belum ada brand pada jadwal ini." },
      {
        key: "tanggal",
        label: "Tanggal",
        sortBy: "value",
        emptyLabel: "Belum ada tanggal pada jadwal ini.",
        value: (r) => ({
          value: r.slot.schedule_date,
          label: r.slot.schedule_date === todayIso ? `${r.slot.schedule_date} (hari ini)` : r.slot.schedule_date,
        }),
      },
      { key: "jam", label: "Jam", sortBy: "value", value: slotHour, emptyLabel: "Belum ada jam mulai pada jadwal ini." },
    ];
  }, [filterable, todayIso]);

  const controls = useTableControls<CompactSlotRow>({
    rows,
    searchText: filterable || searchable ? searchRowText : undefined,
    cm: filterable ? rowCm : undefined,
    facets,
    sort: SORT,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "jadwal",
  });

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{title}</h2>
        <Link href="/schedule" className="text-xs text-slate-500 underline underline-offset-2">
          Buka kalender →
        </Link>
      </div>

      <TableFilterBar
        controls={controls}
        searchPlaceholder={
          showAdsNote
            ? "Cari kreator / brand / tanggal / jam / catatan ads…"
            : "Cari kreator / brand / tanggal / jam…"
        }
        className="mt-3"
      />

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="tanggal" className="px-3 py-2">Tanggal</SortableTh>
                <SortableTh controls={controls} sortKey="kreator" className="px-3 py-2">Kreator</SortableTh>
                <SortableTh controls={controls} sortKey="brand" className="px-3 py-2">Brand</SortableTh>
                <SortableTh controls={controls} sortKey="jam" className="px-3 py-2">Jam</SortableTh>
                {showAdsNote && (
                  <SortableTh controls={controls} sortKey="catatan_ads" className="px-3 py-2">
                    Catatan Ads
                  </SortableTh>
                )}
                <SortableTh controls={controls} sortKey="status" className="px-3 py-2">Status</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((r) => {
                const flags = slotFlags(r.slot, todayIso);
                return (
                  <tr key={r.slot.id}>
                    <td className="px-3 py-2">{r.slot.schedule_date}</td>
                    <td className="px-3 py-2 font-medium">
                      {r.creatorName}
                      {r.creatorUsername && (
                        <span className="ml-1 text-xs text-slate-400">@{r.creatorUsername}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{flags.isOff ? "—" : r.slot.brand_name?.trim() || "Organik"}</td>
                    <td className="px-3 py-2">{timeRange(r.slot)}</td>
                    {showAdsNote && (
                      <td className="max-w-[200px] truncate px-3 py-2" title={r.slot.ads_note ?? ""}>
                        {r.slot.ads_note?.trim() || <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {flags.isDone && <span className="text-green-600">✓ done</span>}
                        {flags.isTentative && (
                          <span className="rounded border border-dashed border-amber-400 px-1 text-[10px] text-amber-700">
                            Tentatif
                          </span>
                        )}
                        {flags.pkMissing && (
                          <span className="rounded bg-red-100 px-1 text-[10px] text-red-700">PK ✘</span>
                        )}
                        {flags.tapNotConnected && (
                          <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">TAP ✘</span>
                        )}
                        {flags.needsVerification && (
                          <span className="rounded bg-red-100 px-1 text-[10px] text-red-700">Belum verifikasi</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={showAdsNote ? 6 : 5} className="px-4 py-5 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada jadwal yang cocok dengan pencarian kreator/brand/tanggal/jam atau filter yang aktif."
                      : emptyLabel}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination controls={controls} />
      </div>
    </section>
  );
}

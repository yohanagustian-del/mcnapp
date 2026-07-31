"use client";

import Link from "next/link";
import { slotFlags } from "@/lib/schedule/indicators";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import { PAGE_SIZE_10, TableFilterBar, TablePagination, useTableControls } from "@/components/table-controls";

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

const searchUsername = (r: CompactSlotRow) => r.creatorUsername;
const rowCm = (r: CompactSlotRow) => ({ id: r.ownerCpmId ?? null, name: r.cmName ?? null });

/**
 * Read-only compact schedule table for workspace pages (CM / BizDev). Reuses
 * src/lib/schedule/indicators.ts for the PK/TAP/tentative/verification badges — no
 * logic duplicated. Always links out to /schedule for the full editable calendar.
 *
 * `filterable` (CM Workspace) menambah search username kreator + filter CM; paginasi
 * 10 baris per halaman selalu aktif. Semua client-side — daftar sudah dimuat server.
 */
export function CompactScheduleList({
  title,
  rows,
  todayIso,
  emptyLabel,
  filterable = false,
}: {
  title: string;
  rows: CompactSlotRow[];
  todayIso: string;
  emptyLabel: string;
  filterable?: boolean;
}) {
  const controls = useTableControls<CompactSlotRow>({
    rows,
    searchText: filterable ? searchUsername : undefined,
    cm: filterable ? rowCm : undefined,
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

      {filterable && <TableFilterBar controls={controls} className="mt-3" />}

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Tanggal</th>
                <th className="px-3 py-2">Kreator</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Jam</th>
                <th className="px-3 py-2">Status</th>
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
                  <td colSpan={5} className="px-4 py-5 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada jadwal yang cocok dengan pencarian username / filter CM."
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

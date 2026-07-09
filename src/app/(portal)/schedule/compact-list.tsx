import Link from "next/link";
import { slotFlags } from "@/lib/schedule/indicators";
import type { LiveScheduleSlot } from "@/lib/schedule/types";

/** Row shape shared by the compact read-only schedule lists in workspace CM/BizDev. */
export interface CompactSlotRow {
  slot: LiveScheduleSlot;
  creatorName: string;
}

function timeRange(slot: LiveScheduleSlot): string {
  if (slot.status === "off") return `OFF${slot.off_reason ? ` — ${slot.off_reason}` : ""}`;
  if (slot.start_time && slot.end_time) return `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
  return "—";
}

/**
 * Read-only compact schedule table for workspace pages (CM / BizDev). Reuses
 * src/lib/schedule/indicators.ts for the PK/TAP/tentative/verification badges — no
 * logic duplicated. Always links out to /schedule for the full editable calendar.
 */
export function CompactScheduleList({
  title,
  rows,
  todayIso,
  emptyLabel,
}: {
  title: string;
  rows: CompactSlotRow[];
  todayIso: string;
  emptyLabel: string;
}) {
  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{title}</h2>
        <Link href="/schedule" className="text-xs text-slate-500 underline underline-offset-2">
          Buka kalender →
        </Link>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
            {rows.map((r) => {
              const flags = slotFlags(r.slot, todayIso);
              return (
                <tr key={r.slot.id}>
                  <td className="px-3 py-2">{r.slot.schedule_date}</td>
                  <td className="px-3 py-2 font-medium">{r.creatorName}</td>
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-center text-slate-400">
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

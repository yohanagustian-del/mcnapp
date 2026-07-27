"use client";

import { useMemo, useState } from "react";
import { creatorDayEmpty, slotFlags } from "@/lib/schedule/indicators";
import { formatDayLabel } from "@/lib/schedule/week";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import { SlotForm, type DealOption, type RosterCreatorOption } from "./slot-form";
import { useCreatorFilter } from "@/components/creator-filter";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

interface Selected {
  slot: LiveScheduleSlot | null; // null = create mode
  creatorId: string;
  date: string;
}

/** Board-level creator, superset of lib RosterCreator with display fields (username, CM name). */
export interface BoardCreator extends RosterCreatorOption {
  owner_cpm_id: string | null;
  cmName: string | null;
}

/** Same shape as lib WeekMatrix, but rows carry BoardCreator for display purposes. */
export interface BoardWeekMatrix {
  weekStart: string;
  days: string[];
  rows: { creator: BoardCreator; cells: LiveScheduleSlot[][] }[];
}

function SlotBlock({ slot, todayIso }: { slot: LiveScheduleSlot; todayIso: string }) {
  const flags = slotFlags(slot, todayIso);
  const label = flags.isOff
    ? `OFF${slot.off_reason ? ` — ${slot.off_reason}` : ""}`
    : slot.brand_name?.trim() || "Organik";
  const time =
    !flags.isOff && slot.start_time && slot.end_time
      ? `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`
      : null;

  const border = flags.needsVerification
    ? "border-red-400 ring-1 ring-red-300"
    : flags.isTentative
    ? "border-dashed border-amber-400"
    : "border-slate-200";

  return (
    <div className={`w-full rounded-md border ${border} bg-slate-50 px-2 py-1 text-left text-xs hover:bg-slate-100`}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-medium text-slate-800">{label}</span>
        {flags.isDone && <span className="text-green-600">✓</span>}
      </div>
      {time && <div className="text-slate-500">{time}</div>}
      <div className="mt-0.5 flex flex-wrap gap-1">
        {flags.pkMissing && (
          <span className="rounded bg-red-100 px-1 text-[10px] text-red-700">PK ✘</span>
        )}
        {flags.tapNotConnected && (
          <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">TAP ✘</span>
        )}
        {flags.isTentative && (
          <span className="rounded border border-dashed border-amber-400 px-1 text-[10px] text-amber-700">
            Tentatif
          </span>
        )}
        {flags.needsVerification && (
          <span className="rounded bg-red-100 px-1 text-[10px] text-red-700">Belum verifikasi</span>
        )}
      </div>
    </div>
  );
}

export function ScheduleBoard({
  matrix,
  creators,
  deals,
  todayIso,
  canEdit,
}: {
  matrix: BoardWeekMatrix;
  creators: RosterCreatorOption[];
  deals: DealOption[];
  todayIso: string;
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const { matches, isActive: filterActive } = useCreatorFilter();
  const visibleRows = useMemo(
    () => matrix.rows.filter((row) => matches(row.creator.name, row.creator.owner_cpm_id)),
    [matrix.rows, matches]
  );
  const tomorrowIso = useMemo(() => {
    const [y, m, d] = todayIso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }, [todayIso]);

  function close() {
    setSelected(null);
  }

  return (
    <div className="space-y-3">
      {selected && (
        <SlotForm
          slot={selected.slot}
          creatorId={selected.creatorId}
          date={selected.date}
          creators={creators}
          deals={deals}
          onDone={close}
          onCancel={close}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3">Kreator</th>
              {matrix.days.map((d) => (
                <th
                  key={d}
                  className={`px-3 py-3 ${d === todayIso ? "bg-indigo-50 text-indigo-700" : ""}`}
                >
                  {formatDayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row) => (
              <tr key={row.creator.id}>
                <td className="sticky left-0 z-10 bg-white px-4 py-2 align-top">
                  <div className="font-medium text-slate-800">{row.creator.name}</div>
                  {row.creator.username && (
                    <div className="text-xs text-slate-400">@{row.creator.username}</div>
                  )}
                  {row.creator.cmName && (
                    <div className="text-xs text-slate-400">CM: {row.creator.cmName}</div>
                  )}
                </td>
                {matrix.days.map((d, i) => {
                  const cell = row.cells[i];
                  const emptyTomorrow = d === tomorrowIso && creatorDayEmpty(row.cells, matrix.days, tomorrowIso);
                  return (
                    <td key={d} className={`min-w-[160px] px-2 py-2 align-top ${d === todayIso ? "bg-indigo-50/40" : ""}`}>
                      <div className="space-y-1">
                        {cell.map((slot) => (
                          <button
                            key={slot.id}
                            type="button"
                            className="block w-full text-left"
                            onClick={() => canEdit && setSelected({ slot, creatorId: row.creator.id, date: d })}
                          >
                            <SlotBlock slot={slot} todayIso={todayIso} />
                          </button>
                        ))}
                        {emptyTomorrow && (
                          <p className="rounded-md bg-red-50 px-1.5 py-1 text-[10px] text-red-600">
                            Besok belum ada jadwal
                          </p>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setSelected({ slot: null, creatorId: row.creator.id, date: d })}
                            className={`${btnSmall} w-full border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600`}
                          >
                            + slot
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={matrix.days.length + 1} className="px-4 py-6 text-center text-slate-400">
                  {filterActive
                    ? "Tidak ada kreator yang cocok dengan pencarian / filter CM."
                    : "Belum ada kreator di roster live — aktifkan di bagian “Kelola Roster” di bawah."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

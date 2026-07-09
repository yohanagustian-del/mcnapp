// Build the weekly schedule matrix: one row per roster creator, 7 day-cells, each cell
// holding that creator's slots for that day sorted by start_time. Pure — no supabase.

import { getWeekDays } from "./week";
import type { LiveScheduleSlot, RosterCreator } from "./types";

export interface WeekMatrixRow {
  creator: RosterCreator;
  cells: LiveScheduleSlot[][]; // length 7, Mon..Sun
}

export interface WeekMatrix {
  weekStart: string;
  days: string[]; // 7 ISO dates
  rows: WeekMatrixRow[];
}

/** OFF/empty times sort last; otherwise ascending by start_time (string compare is fine for HH:MM). */
function byStartTime(a: LiveScheduleSlot, b: LiveScheduleSlot): number {
  if (a.start_time === b.start_time) return a.id - b.id;
  if (a.start_time === null) return 1;
  if (b.start_time === null) return -1;
  return a.start_time < b.start_time ? -1 : 1;
}

/**
 * Group slots into a creator×day matrix for `weekStart`. Slots whose creator is not in
 * `creators`, or whose date falls outside the week, are dropped. Cells are sorted by
 * start_time (nulls last, then id) so the render order is deterministic.
 */
export function buildWeekMatrix(
  creators: RosterCreator[],
  slots: LiveScheduleSlot[],
  weekStart: string
): WeekMatrix {
  const days = getWeekDays(weekStart);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const rows: WeekMatrixRow[] = creators.map((creator) => ({
    creator,
    cells: Array.from({ length: 7 }, () => [] as LiveScheduleSlot[]),
  }));
  const rowByCreator = new Map(rows.map((r) => [r.creator.id, r]));

  for (const slot of slots) {
    const row = rowByCreator.get(slot.creator_id);
    if (!row) continue;
    const idx = dayIndex.get(slot.schedule_date);
    if (idx === undefined) continue;
    row.cells[idx].push(slot);
  }

  for (const row of rows) {
    for (const cell of row.cells) cell.sort(byStartTime);
  }

  return { weekStart, days, rows };
}

// Derived UI indicators for schedule slots and cells. Pure — no supabase, no config.
// These drive the visual flags in the calendar (PK missing, TAP not connected, needs
// verification, tentative/off/done, "besok belum ada jadwal").

import type { LiveScheduleSlot } from "./types";

export interface SlotFlags {
  /** scheduled/tentative slot whose Product Knowledge is not yet prepared. */
  pkMissing: boolean;
  /** scheduled/tentative slot whose product set is not connected in TAP. */
  tapNotConnected: boolean;
  /** past-dated slot still awaiting verification (scheduled|tentative, date < today). */
  needsVerification: boolean;
  isTentative: boolean;
  isOff: boolean;
  isDone: boolean;
}

function isPending(slot: LiveScheduleSlot): boolean {
  return slot.status === "scheduled" || slot.status === "tentative";
}

/** Per-slot indicator flags, relative to `todayIso` (YYYY-MM-DD). */
export function slotFlags(slot: LiveScheduleSlot, todayIso: string): SlotFlags {
  const pending = isPending(slot);
  return {
    pkMissing: pending && !slot.pk_ready,
    tapNotConnected: pending && !slot.product_connected_tap,
    needsVerification: pending && slot.schedule_date < todayIso,
    isTentative: slot.status === "tentative",
    isOff: slot.status === "off",
    isDone: slot.status === "done",
  };
}

/**
 * "Besok belum ada jadwal" helper: true when the cell for `dayIso` has zero slots and
 * is not explicitly marked off. `cells`/`days` are a matrix row's cells and the week's
 * day list (same order). If `dayIso` is not in this week, returns false (nothing to warn).
 */
export function creatorDayEmpty(
  cells: LiveScheduleSlot[][],
  days: string[],
  dayIso: string
): boolean {
  const idx = days.indexOf(dayIso);
  if (idx === -1) return false;
  const cell = cells[idx];
  if (cell.length === 0) return true;
  // A day with only OFF slots is deliberately not-live, not "belum ada jadwal".
  return false;
}

// Pure copy-week transform. Given the source week's slots, produce insert payloads for
// the target week: same creator, same weekday offset, same times & deal/product fields,
// but reset to a fresh unverified 'scheduled' state. OFF and cancelled slots are skipped
// (nothing to repeat). The server action (copyWeekAction) supplies created_by and does
// the actual insert. No supabase.

import type { LiveScheduleSlot, SlotInsert } from "./types";

const DAY_MS = 86_400_000;

function parseIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function toIso(epoch: number): string {
  const dt = new Date(epoch);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * Map each non-OFF source slot to a target-week insert payload, preserving the weekday
 * offset from `sourceWeekStart`. Verification/actual fields are cleared and status is
 * reset to 'scheduled' with pk_ready/product_connected_tap → false. `createdBy` stamps
 * created_by on every payload. Slots outside the 7-day source window are skipped.
 */
export function buildCopiedSlots(
  sourceSlots: LiveScheduleSlot[],
  sourceWeekStart: string,
  targetWeekStart: string,
  createdBy: string
): SlotInsert[] {
  const srcStart = parseIso(sourceWeekStart);
  const tgtStart = parseIso(targetWeekStart);
  const out: SlotInsert[] = [];

  for (const slot of sourceSlots) {
    if (slot.status === "off" || slot.status === "cancelled") continue;
    const offsetDays = Math.round((parseIso(slot.schedule_date) - srcStart) / DAY_MS);
    if (offsetDays < 0 || offsetDays > 6) continue;

    out.push({
      creator_id: slot.creator_id,
      schedule_date: toIso(tgtStart + offsetDays * DAY_MS),
      start_time: slot.start_time,
      end_time: slot.end_time,
      status: "scheduled",
      off_reason: null,
      brand_name: slot.brand_name,
      deal_id: slot.deal_id,
      shop_key: slot.shop_key,
      deals_by: slot.deals_by,
      ads_payer: slot.ads_payer,
      ads_note: slot.ads_note,
      pk_ready: false,
      product_set_title: slot.product_set_title,
      product_connected_tap: false,
      fokus_produk: slot.fokus_produk,
      created_by: createdBy,
    });
  }

  return out;
}

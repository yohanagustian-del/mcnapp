import { describe, expect, it } from "vitest";
import { buildWeekMatrix } from "../matrix";
import type { LiveScheduleSlot, RosterCreator } from "../types";

function slot(partial: Partial<LiveScheduleSlot> & { id: number; creator_id: string; schedule_date: string }): LiveScheduleSlot {
  return {
    start_time: "10:00",
    end_time: "12:00",
    status: "scheduled",
    off_reason: null,
    brand_name: null,
    deal_id: null,
    shop_key: null,
    deals_by: null,
    ads_payer: null,
    ads_note: null,
    pk_ready: false,
    product_set_title: null,
    product_connected_tap: false,
    fokus_produk: null,
    actual_start: null,
    actual_end: null,
    verified_by: null,
    verified_at: null,
    created_by: "m1",
    updated_by: null,
    created_at: null,
    updated_at: null,
    ...partial,
  };
}

const creators: RosterCreator[] = [
  { id: "CRT-a", name: "Alpha", owner_cpm_id: "cpm-1" },
  { id: "CRT-b", name: "Beta", owner_cpm_id: "cpm-2" },
];

describe("buildWeekMatrix", () => {
  it("produces a row per creator with 7 cells and the week's day list", () => {
    const m = buildWeekMatrix(creators, [], "2026-05-11");
    expect(m.rows).toHaveLength(2);
    expect(m.days).toHaveLength(7);
    expect(m.days[0]).toBe("2026-05-11");
    for (const r of m.rows) expect(r.cells).toHaveLength(7);
  });

  it("groups slots into the correct creator×day cell", () => {
    const slots = [
      slot({ id: 1, creator_id: "CRT-a", schedule_date: "2026-05-11" }),
      slot({ id: 2, creator_id: "CRT-b", schedule_date: "2026-05-13" }),
    ];
    const m = buildWeekMatrix(creators, slots, "2026-05-11");
    expect(m.rows[0].cells[0].map((s) => s.id)).toEqual([1]); // Alpha, Monday
    expect(m.rows[1].cells[2].map((s) => s.id)).toEqual([2]); // Beta, Wednesday
  });

  it("sorts a cell by start_time, nulls (off) last, then id", () => {
    const slots = [
      slot({ id: 1, creator_id: "CRT-a", schedule_date: "2026-05-11", start_time: "14:00" }),
      slot({ id: 2, creator_id: "CRT-a", schedule_date: "2026-05-11", start_time: "09:00" }),
      slot({ id: 3, creator_id: "CRT-a", schedule_date: "2026-05-11", start_time: null, status: "off" }),
      slot({ id: 4, creator_id: "CRT-a", schedule_date: "2026-05-11", start_time: null, status: "off" }),
    ];
    const m = buildWeekMatrix(creators, slots, "2026-05-11");
    expect(m.rows[0].cells[0].map((s) => s.id)).toEqual([2, 1, 3, 4]);
  });

  it("drops slots outside the week and for unknown creators", () => {
    const slots = [
      slot({ id: 1, creator_id: "CRT-a", schedule_date: "2026-05-18" }), // next week
      slot({ id: 2, creator_id: "CRT-x", schedule_date: "2026-05-12" }), // unknown creator
      slot({ id: 3, creator_id: "CRT-a", schedule_date: "2026-05-12" }), // valid
    ];
    const m = buildWeekMatrix(creators, slots, "2026-05-11");
    const kept = m.rows.flatMap((r) => r.cells.flat()).map((s) => s.id);
    expect(kept).toEqual([3]);
  });
});

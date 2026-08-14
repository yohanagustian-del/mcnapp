import { describe, expect, it } from "vitest";
import { creatorDayEmpty, slotFlags } from "../indicators";
import type { LiveScheduleSlot } from "../types";

function slot(partial: Partial<LiveScheduleSlot>): LiveScheduleSlot {
  return {
    id: 1,
    creator_id: "CRT-a",
    schedule_date: "2026-05-11",
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

const TODAY = "2026-05-11";

describe("slotFlags", () => {
  it("flags pkMissing and tapNotConnected for a pending slot with both unset", () => {
    const f = slotFlags(slot({ pk_ready: false, product_connected_tap: false }), TODAY);
    expect(f.pkMissing).toBe(true);
    expect(f.tapNotConnected).toBe(true);
  });

  it("clears pk/tap flags when both prepared", () => {
    const f = slotFlags(slot({ pk_ready: true, product_connected_tap: true }), TODAY);
    expect(f.pkMissing).toBe(false);
    expect(f.tapNotConnected).toBe(false);
  });

  it("does not flag pk/tap for off or done slots", () => {
    expect(slotFlags(slot({ status: "off" }), TODAY).pkMissing).toBe(false);
    expect(slotFlags(slot({ status: "done" }), TODAY).tapNotConnected).toBe(false);
  });

  it("needsVerification only for pending slots strictly before today", () => {
    expect(slotFlags(slot({ schedule_date: "2026-05-10" }), TODAY).needsVerification).toBe(true);
    expect(slotFlags(slot({ schedule_date: "2026-05-11" }), TODAY).needsVerification).toBe(false); // today
    expect(slotFlags(slot({ schedule_date: "2026-05-12" }), TODAY).needsVerification).toBe(false); // future
    expect(
      slotFlags(slot({ schedule_date: "2026-05-10", status: "done" }), TODAY).needsVerification
    ).toBe(false);
  });

  it("reports status booleans", () => {
    expect(slotFlags(slot({ status: "tentative" }), TODAY).isTentative).toBe(true);
    expect(slotFlags(slot({ status: "off" }), TODAY).isOff).toBe(true);
    expect(slotFlags(slot({ status: "done" }), TODAY).isDone).toBe(true);
  });
});

describe("creatorDayEmpty", () => {
  const days = [
    "2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14",
    "2026-05-15", "2026-05-16", "2026-05-17",
  ];

  it("true when the day has zero slots", () => {
    const cells: LiveScheduleSlot[][] = days.map(() => []);
    expect(creatorDayEmpty(cells, days, "2026-05-12")).toBe(true);
  });

  it("false when the day has any slot", () => {
    const cells: LiveScheduleSlot[][] = days.map(() => []);
    cells[1] = [slot({ schedule_date: "2026-05-12" })];
    expect(creatorDayEmpty(cells, days, "2026-05-12")).toBe(false);
  });

  it("false when the day is marked off (deliberately not-live)", () => {
    const cells: LiveScheduleSlot[][] = days.map(() => []);
    cells[1] = [slot({ schedule_date: "2026-05-12", status: "off", start_time: null })];
    expect(creatorDayEmpty(cells, days, "2026-05-12")).toBe(false);
  });

  it("false when the day is not in this week", () => {
    const cells: LiveScheduleSlot[][] = days.map(() => []);
    expect(creatorDayEmpty(cells, days, "2026-06-01")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildCopiedSlots } from "../copy-week";
import type { LiveScheduleSlot } from "../types";

function slot(partial: Partial<LiveScheduleSlot> & { id: number; schedule_date: string }): LiveScheduleSlot {
  return {
    creator_id: "CRT-a",
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

const SRC = "2026-05-11";
const TGT = "2026-05-18";

describe("buildCopiedSlots", () => {
  it("preserves the weekday offset onto the target week", () => {
    const src = [
      slot({ id: 1, schedule_date: "2026-05-11" }), // Mon (offset 0)
      slot({ id: 2, schedule_date: "2026-05-14" }), // Thu (offset 3)
    ];
    const out = buildCopiedSlots(src, SRC, TGT, "actor-1");
    expect(out.map((p) => p.schedule_date)).toEqual(["2026-05-18", "2026-05-21"]);
  });

  it("skips OFF slots", () => {
    const src = [
      slot({ id: 1, schedule_date: "2026-05-11" }),
      slot({ id: 2, schedule_date: "2026-05-12", status: "off", start_time: null, end_time: null, off_reason: "pulang kampung" }),
    ];
    const out = buildCopiedSlots(src, SRC, TGT, "actor-1");
    expect(out).toHaveLength(1);
    expect(out[0].schedule_date).toBe("2026-05-18");
  });

  it("resets status/pk/tap and clears verification & off_reason; stamps created_by", () => {
    const src = [
      slot({
        id: 1,
        schedule_date: "2026-05-11",
        status: "tentative",
        pk_ready: true,
        product_connected_tap: true,
        actual_start: "10:05",
        actual_end: "11:55",
        verified_by: "v-1",
        verified_at: "2026-05-11T12:00:00Z",
        off_reason: "x",
      }),
    ];
    const [p] = buildCopiedSlots(src, SRC, TGT, "actor-9");
    expect(p.status).toBe("scheduled");
    expect(p.pk_ready).toBe(false);
    expect(p.product_connected_tap).toBe(false);
    expect(p.off_reason).toBeNull();
    expect(p.created_by).toBe("actor-9");
    // Preserved fields:
    expect(p.start_time).toBe("10:00");
    expect(p.end_time).toBe("12:00");
    // Payload has no actual/verified fields (fresh insert):
    expect(p).not.toHaveProperty("actual_start");
    expect(p).not.toHaveProperty("verified_by");
  });

  it("carries brand/deal/ads/product fields through", () => {
    const src = [
      slot({
        id: 1,
        schedule_date: "2026-05-11",
        brand_name: "MIX Brand",
        deal_id: "DEAL-1",
        deals_by: "bd",
        ads_payer: "brand",
        ads_note: "Rp500rb",
        product_set_title: "Set A",
        fokus_produk: "Serum",
      }),
    ];
    const [p] = buildCopiedSlots(src, SRC, TGT, "actor-1");
    expect(p.brand_name).toBe("MIX Brand");
    expect(p.deal_id).toBe("DEAL-1");
    expect(p.deals_by).toBe("bd");
    expect(p.ads_payer).toBe("brand");
    expect(p.ads_note).toBe("Rp500rb");
    expect(p.product_set_title).toBe("Set A");
    expect(p.fokus_produk).toBe("Serum");
  });

  it("skips slots outside the 7-day source window", () => {
    const src = [
      slot({ id: 1, schedule_date: "2026-05-11" }), // in window
      slot({ id: 2, schedule_date: "2026-05-18" }), // offset 7 → out
      slot({ id: 3, schedule_date: "2026-05-10" }), // offset -1 → out
    ];
    const out = buildCopiedSlots(src, SRC, TGT, "actor-1");
    expect(out).toHaveLength(1);
    expect(out[0].schedule_date).toBe("2026-05-18");
  });
});

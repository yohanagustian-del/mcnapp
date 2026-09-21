import { describe, expect, it } from "vitest";
import { slotLiveBadgeLabel, slotUploadEligibility, summarizeSlotLive } from "../live-report";

describe("slotUploadEligibility", () => {
  const today = "2026-09-21";
  it("allows a past scheduled/tentative/done slot", () => {
    expect(slotUploadEligibility({ status: "scheduled", schedule_date: "2026-09-20" }, today).ok).toBe(true);
    expect(slotUploadEligibility({ status: "tentative", schedule_date: "2026-09-21" }, today).ok).toBe(true);
    expect(slotUploadEligibility({ status: "done", schedule_date: "2026-09-19" }, today).ok).toBe(true);
  });
  it("refuses OFF and cancelled slots with a reason", () => {
    const off = slotUploadEligibility({ status: "off", schedule_date: "2026-09-20" }, today);
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toContain("OFF");
    const cancelled = slotUploadEligibility({ status: "cancelled", schedule_date: "2026-09-20" }, today);
    expect(cancelled.ok).toBe(false);
  });
  it("refuses future slots", () => {
    const res = slotUploadEligibility({ status: "scheduled", schedule_date: "2026-09-22" }, today);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("masa depan");
  });
});

describe("summarizeSlotLive", () => {
  it("counts only verified/confirmed_manual sessions and prefers a final report", () => {
    const map = summarizeSlotLive(
      [
        { schedule_slot_id: 1, gmv: "1000000", attribution_status: "verified" },
        { schedule_slot_id: 1, gmv: 500000, attribution_status: "confirmed_manual" },
        { schedule_slot_id: 1, gmv: 999999, attribution_status: "voided" },
        { schedule_slot_id: 2, gmv: 10, attribution_status: "disputed" },
        { schedule_slot_id: null, gmv: 10, attribution_status: "verified" },
      ],
      [
        { schedule_slot_id: 1, status: "draft" },
        { schedule_slot_id: 1, status: "final" },
        { schedule_slot_id: 3, status: "draft" },
      ]
    );
    expect(map.get(1)).toEqual({ slotId: 1, sessions: 2, gmv: 1_500_000, reportStatus: "final" });
    expect(map.get(2)).toBeUndefined(); // disputed saja → tidak ada yang dihitung
    expect(map.get(3)).toEqual({ slotId: 3, sessions: 0, gmv: 0, reportStatus: "draft" });
  });
});

describe("slotLiveBadgeLabel", () => {
  it("returns null when there is nothing to show", () => {
    expect(slotLiveBadgeLabel(undefined)).toBeNull();
    expect(slotLiveBadgeLabel({ slotId: 1, sessions: 0, gmv: 0, reportStatus: null })).toBeNull();
  });
  it("joins sessions and report status", () => {
    expect(slotLiveBadgeLabel({ slotId: 1, sessions: 2, gmv: 1, reportStatus: "final" })).toBe("2 sesi · Report final");
    expect(slotLiveBadgeLabel({ slotId: 1, sessions: 1, gmv: 1, reportStatus: null })).toBe("1 sesi");
  });
});

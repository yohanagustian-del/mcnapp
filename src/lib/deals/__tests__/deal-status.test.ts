import { describe, expect, it } from "vitest";
import {
  dealStatusLabel,
  isLegacyStatusCheckError,
  normalizeDealStatus,
  toLegacyDealStatus,
  writeWithDealStatusFallback,
} from "../deal-status";

describe("normalizeDealStatus (DECISIONS D-2026-10-20-1)", () => {
  it("variasi sheet → nilai baru, trim & case-insensitive", () => {
    expect(normalizeDealStatus("Reguler ")).toBe("reguler");
    expect(normalizeDealStatus("running")).toBe("running_1st_month");
    expect(normalizeDealStatus("Running 1st Month")).toBe("running_1st_month");
    expect(normalizeDealStatus("Running Bulan pertama")).toBe("running_1st_month");
    expect(normalizeDealStatus("Retention")).toBe("retention");
    expect(normalizeDealStatus("Hold")).toBe("hold");
    expect(normalizeDealStatus("Stop")).toBe("stop");
  });

  it("nilai lama: done → stop; kosong/tak dikenal → null", () => {
    expect(normalizeDealStatus("done")).toBe("stop");
    expect(normalizeDealStatus("")).toBeNull();
    expect(normalizeDealStatus(null)).toBeNull();
    expect(normalizeDealStatus("Deal")).toBeNull();
  });

  it("label tampil untuk nilai lama maupun baru", () => {
    expect(dealStatusLabel("running")).toBe("Running Bulan Pertama");
    expect(dealStatusLabel("running_1st_month")).toBe("Running Bulan Pertama");
    expect(dealStatusLabel(null)).toBe("—");
  });

  it("fallback ke CHECK lama: stop→done, hold→hold, sisanya running", () => {
    expect(toLegacyDealStatus("stop")).toBe("done");
    expect(toLegacyDealStatus("hold")).toBe("hold");
    expect(toLegacyDealStatus("reguler")).toBe("running");
    expect(toLegacyDealStatus("retention")).toBe("running");
    expect(toLegacyDealStatus("running_1st_month")).toBe("running");
    expect(toLegacyDealStatus(null)).toBeNull();
  });
});

describe("writeWithDealStatusFallback", () => {
  const checkError = {
    code: "23514",
    message: 'new row for relation "brand_deals" violates check constraint "brand_deals_status_check"',
  };

  it("mengulang sekali dengan status lama bila CHECK lama menolak", async () => {
    const seen: (string | null | undefined)[] = [];
    const res = await writeWithDealStatusFallback({ status: "stop" as string | null }, async (rec) => {
      seen.push(rec.status);
      return { error: rec.status === "done" ? null : checkError };
    });
    expect(seen).toEqual(["stop", "done"]);
    expect(res).toEqual({ error: null, usedLegacyStatus: true });
  });

  it("error lain tidak diulang", async () => {
    let calls = 0;
    const res = await writeWithDealStatusFallback({ status: "hold" }, async () => {
      calls++;
      return { error: { code: "42501", message: "permission denied" } };
    });
    expect(calls).toBe(1);
    expect(res.usedLegacyStatus).toBe(false);
    expect(isLegacyStatusCheckError(res.error)).toBe(false);
  });
});

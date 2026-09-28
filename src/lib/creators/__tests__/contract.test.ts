import { describe, expect, it } from "vitest";
import { contractBucket, contractDays, contractRemaining, type ContractAlertDays } from "../contract";

const ALERT: ContractAlertDays = { warning: 60, danger: 30 };
const DAY_MS = 86_400_000;

describe("contractDays", () => {
  it("null bila join atau end kosong", () => {
    expect(contractDays(null, "2026-12-31", Date.now())).toBeNull();
    expect(contractDays("2026-01-01", null, Date.now())).toBeNull();
  });

  it("menghitung sisa hari dari nowMs ke end", () => {
    const now = Date.parse("2026-09-01T00:00:00Z");
    expect(contractDays("2026-01-01", "2026-09-11", now)).toBe(10);
    expect(contractDays("2026-01-01", "2026-08-22", now)).toBe(-10);
  });
});

describe("contractRemaining", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");

  it("— bila data belum lengkap", () => {
    expect(contractRemaining(null, null, now, ALERT)).toEqual({ label: "—", danger: false });
  });

  it("danger=true dan label 'habis' untuk kontrak yang sudah lewat", () => {
    const r = contractRemaining("2026-01-01", "2026-08-22", now, ALERT);
    expect(r.danger).toBe(true);
    expect(r.label).toBe("habis 10 hr lalu");
  });

  it("danger=true untuk sisa <= alertDays.danger", () => {
    const end = new Date(now + 20 * DAY_MS).toISOString().slice(0, 10);
    const r = contractRemaining("2026-01-01", end, now, ALERT);
    expect(r.danger).toBe(true);
    expect(r.label).toBe("20 hari");
  });

  it("danger=false untuk sisa di antara danger dan warning", () => {
    const end = new Date(now + 45 * DAY_MS).toISOString().slice(0, 10);
    const r = contractRemaining("2026-01-01", end, now, ALERT);
    expect(r.danger).toBe(false);
    expect(r.label).toBe("45 hari");
  });

  it("label bulan+hari untuk sisa di atas warning", () => {
    const end = new Date(now + 100 * DAY_MS).toISOString().slice(0, 10);
    const r = contractRemaining("2026-01-01", end, now, ALERT);
    expect(r.danger).toBe(false);
    expect(r.label).toBe("3 bln 10 hr");
  });
});

describe("contractBucket", () => {
  it("unknown/expired/danger/warning/ok sesuai ambang", () => {
    expect(contractBucket(null, ALERT)).toBe("unknown");
    expect(contractBucket(-1, ALERT)).toBe("expired");
    expect(contractBucket(30, ALERT)).toBe("danger");
    expect(contractBucket(45, ALERT)).toBe("warning");
    expect(contractBucket(61, ALERT)).toBe("ok");
  });
});

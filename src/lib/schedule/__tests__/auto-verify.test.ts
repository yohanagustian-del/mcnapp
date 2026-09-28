import { describe, expect, it } from "vitest";
import { autoVerifyCorrectionDeadline, canReviseAutoVerified } from "../auto-verify";

describe("autoVerifyCorrectionDeadline", () => {
  it("menambah N hari ke verified_at", () => {
    expect(autoVerifyCorrectionDeadline("2026-09-01T10:00:00.000Z", 7)).toBe("2026-09-08T10:00:00.000Z");
  });
});

describe("canReviseAutoVerified (PLAN_MSDPS Paket B, Q5)", () => {
  const AUTO = { status: "done", actual_time_source: "auto_sistem", verified_at: "2026-09-01T00:00:00.000Z" };

  it("true dalam jendela koreksi", () => {
    expect(canReviseAutoVerified(AUTO, 7, "2026-09-05T00:00:00.000Z")).toBe(true);
  });

  it("false setelah jendela koreksi lewat", () => {
    expect(canReviseAutoVerified(AUTO, 7, "2026-09-09T00:00:00.000Z")).toBe(false);
  });

  it("false untuk slot verifikasi MANUAL (input_manual/sesuai_rencana) — tetap terkunci selamanya", () => {
    expect(canReviseAutoVerified({ ...AUTO, actual_time_source: "input_manual" }, 7, "2026-09-02T00:00:00.000Z")).toBe(false);
    expect(canReviseAutoVerified({ ...AUTO, actual_time_source: "sesuai_rencana" }, 7, "2026-09-02T00:00:00.000Z")).toBe(false);
  });

  it("false untuk slot yang belum diverifikasi sama sekali (scheduled/tentative) — bukan kasus koreksi", () => {
    expect(canReviseAutoVerified({ status: "scheduled", actual_time_source: null, verified_at: null }, 7, "2026-09-02T00:00:00.000Z")).toBe(false);
  });

  it("false untuk slot cancelled (bukan done)", () => {
    expect(canReviseAutoVerified({ ...AUTO, status: "cancelled" }, 7, "2026-09-02T00:00:00.000Z")).toBe(false);
  });
});

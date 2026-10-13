import { describe, expect, it } from "vitest";
import { parsePeriodParam, periodOptions, weeksInMonth } from "../period";

describe("parsePeriodParam (Q2: default bulan berjalan)", () => {
  it("kosong / rusak → bulan berjalan", () => {
    for (const raw of [undefined, "", "abc", "2026-13", "2026-02-W5"]) {
      const p = parsePeriodParam(raw, "2026-10-13");
      expect(p.kind, String(raw)).toBe("month");
      expect(p.value).toBe("2026-10");
    }
  });

  it("bulan lain", () => {
    expect(parsePeriodParam("2026-09", "2026-10-13")).toMatchObject({
      kind: "month", month: "2026-09", monthStart: "2026-09-01", label: "September 2026",
    });
  });

  it("minggu W1–W5 → period_start skema ingest", () => {
    expect(parsePeriodParam("2026-09-W2", "2026-10-13")).toMatchObject({
      kind: "week", week: 2, periodStart: "2026-09-08", label: "W2 September 2026",
    });
    expect(parsePeriodParam("2026-08-w5", "2026-10-13")).toMatchObject({ kind: "week", periodStart: "2026-08-29" });
  });

  it("Februari non-kabisat tidak punya W5", () => {
    expect(weeksInMonth("2027-02")).toEqual([1, 2, 3, 4]);
    expect(weeksInMonth("2028-02")).toEqual([1, 2, 3, 4, 5]);
  });

  it("opsi dropdown: bulan terbaru dulu, diikuti minggunya", () => {
    const opts = periodOptions("2026-10-13", 2);
    expect(opts[0].value).toBe("2026-10");
    expect(opts[1].value).toBe("2026-10-W1");
    expect(opts.find((o) => o.value === "2026-09")).toBeTruthy();
  });
});

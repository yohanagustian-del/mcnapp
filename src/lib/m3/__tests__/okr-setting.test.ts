import { describe, expect, it } from "vitest";
import {
  EMPTY_OKR_FIELDS,
  formatPeriodRange,
  isNewObjectiveMode,
  krDirectionLabel,
  NEW_OBJECTIVE,
  objectiveChoicesFor,
  okrNamesOf,
  toOkrSettingFormData,
  validateAssignPeriod,
  type ObjectiveOption,
  type OkrSettingFieldValue,
} from "../okr-setting";

const OBJECTIVES: ObjectiveOption[] = [
  { id: 1, okrName: "OKR divisi CM", objective: "Meningkatkan kualitas kreator" },
  { id: 2, okrName: "OKR divisi CM", objective: "Meningkatkan kualitas campaign" },
  { id: 3, okrName: "OKR divisi akuisisi", objective: "Meningkatkan kontribusi revenue" },
];

describe("objectiveChoicesFor", () => {
  it("only offers objectives that belong to the typed OKR name", () => {
    expect(objectiveChoicesFor(OBJECTIVES, "OKR divisi CM").map((o) => o.id)).toEqual([1, 2]);
    expect(objectiveChoicesFor(OBJECTIVES, "OKR divisi akuisisi").map((o) => o.id)).toEqual([3]);
  });

  it("matches case-insensitively and ignores surrounding spaces", () => {
    expect(objectiveChoicesFor(OBJECTIVES, "  okr divisi cm ").map((o) => o.id)).toEqual([1, 2]);
  });

  it("offers nothing for an empty or unknown OKR name", () => {
    expect(objectiveChoicesFor(OBJECTIVES, "")).toEqual([]);
    expect(objectiveChoicesFor(OBJECTIVES, "   ")).toEqual([]);
    expect(objectiveChoicesFor(OBJECTIVES, "OKR divisi bizdev")).toEqual([]);
  });
});

describe("okrNamesOf", () => {
  it("deduplicates names and sorts them", () => {
    expect(okrNamesOf(OBJECTIVES)).toEqual(["OKR divisi akuisisi", "OKR divisi CM"]);
  });
});

describe("isNewObjectiveMode", () => {
  const value = (patch: Partial<OkrSettingFieldValue> = {}): OkrSettingFieldValue => ({
    ...EMPTY_OKR_FIELDS,
    ...patch,
  });

  it("is on when the user picked the sentinel option", () => {
    const choices = objectiveChoicesFor(OBJECTIVES, "OKR divisi CM");
    expect(isNewObjectiveMode(value({ objectiveId: NEW_OBJECTIVE }), choices)).toBe(true);
  });

  it("is on when the OKR name has no objective yet — writing one is the only path", () => {
    expect(isNewObjectiveMode(value({ okrName: "OKR divisi baru" }), [])).toBe(true);
  });

  it("is off when an existing objective is selected", () => {
    const choices = objectiveChoicesFor(OBJECTIVES, "OKR divisi CM");
    expect(isNewObjectiveMode(value({ objectiveId: "1" }), choices)).toBe(false);
  });
});

describe("toOkrSettingFormData", () => {
  const filled: OkrSettingFieldValue = {
    okrName: "OKR divisi CM",
    objectiveId: "2",
    objectiveNew: "paragraf yang tidak dipakai",
    keyResult: "Total GMV kreator baru",
    target: "Rp100.000.000",
    targetUnit: "rupiah",
    krDirection: "positif",
  };

  it("sends objective_id and never objective_new when picking an existing objective", () => {
    const choices = objectiveChoicesFor(OBJECTIVES, filled.okrName);
    const fd = toOkrSettingFormData(filled, choices);
    expect(fd.get("objective_id")).toBe("2");
    expect(fd.get("objective_new")).toBe("");
    expect(fd.get("okr_name")).toBe("OKR divisi CM");
    expect(fd.get("key_result")).toBe("Total GMV kreator baru");
    // Target dikirim mentah — parseRupiah di server yang menormalkannya.
    expect(fd.get("target")).toBe("Rp100.000.000");
    expect(fd.get("target_unit")).toBe("rupiah");
    expect(fd.get("kr_direction")).toBe("positif");
  });

  it("carries a negative KR direction through", () => {
    const choices = objectiveChoicesFor(OBJECTIVES, filled.okrName);
    const fd = toOkrSettingFormData({ ...filled, krDirection: "negatif" }, choices);
    expect(fd.get("kr_direction")).toBe("negatif");
  });

  it("sends objective_new and never objective_id when writing a new objective", () => {
    const choices = objectiveChoicesFor(OBJECTIVES, filled.okrName);
    const fd = toOkrSettingFormData({ ...filled, objectiveId: NEW_OBJECTIVE }, choices);
    expect(fd.get("objective_id")).toBe("");
    expect(fd.get("objective_new")).toBe("paragraf yang tidak dipakai");
  });

  it("falls back to objective_new for an OKR name that has no objective yet", () => {
    const fd = toOkrSettingFormData(
      { ...filled, okrName: "OKR divisi baru", objectiveId: "2", objectiveNew: "Objective pertama" },
      []
    );
    expect(fd.get("objective_id")).toBe("");
    expect(fd.get("objective_new")).toBe("Objective pertama");
  });
});

describe("krDirectionLabel", () => {
  it("labels a negative KR as lower-is-better with a max target", () => {
    const { label, hint } = krDirectionLabel("negatif");
    expect(label).toBe("Negatif ↓");
    expect(hint).toContain("maksimal");
  });

  it("labels positive — and anything unset — as higher-is-better", () => {
    expect(krDirectionLabel("positif").label).toBe("Positif ↑");
    expect(krDirectionLabel(null).label).toBe("Positif ↑");
    expect(krDirectionLabel(undefined).hint).toContain("minimal");
  });
});

describe("validateAssignPeriod", () => {
  it("accepts a well-ordered range", () => {
    expect(validateAssignPeriod("2026-07-01", "2026-09-30")).toBeNull();
    // Satu hari (awal = akhir) tetap periode yang sah.
    expect(validateAssignPeriod("2026-07-01", "2026-07-01")).toBeNull();
  });

  it("requires both dates", () => {
    expect(validateAssignPeriod("", "2026-09-30")).toMatch(/wajib diisi/);
    expect(validateAssignPeriod("2026-07-01", "")).toMatch(/wajib diisi/);
  });

  it("rejects an end date before the start date", () => {
    expect(validateAssignPeriod("2026-09-30", "2026-07-01")).toMatch(/tidak boleh sebelum/);
  });

  it("rejects non-ISO dates (input type=date always sends ISO)", () => {
    expect(validateAssignPeriod("01/07/2026", "2026-09-30")).toMatch(/tidak valid/);
  });
});

describe("formatPeriodRange", () => {
  it("renders an Indonesian range", () => {
    expect(formatPeriodRange("2026-07-01", "2026-09-30")).toBe("1 Jul 2026 – 30 Sep 2026");
  });

  it("marks legacy assignments that have no period yet", () => {
    expect(formatPeriodRange(null, null)).toBe("periode belum diisi");
  });

  it("shows a placeholder for a half-filled range instead of guessing", () => {
    expect(formatPeriodRange("2026-07-01", null)).toBe("1 Jul 2026 – ?");
  });
});

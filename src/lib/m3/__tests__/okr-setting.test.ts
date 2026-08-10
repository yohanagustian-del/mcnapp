import { describe, expect, it } from "vitest";
import {
  EMPTY_OKR_FIELDS,
  isNewObjectiveMode,
  NEW_OBJECTIVE,
  objectiveChoicesFor,
  okrNamesOf,
  toOkrSettingFormData,
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

import { describe, expect, it } from "vitest";
import { compareSortValues, nextSortState, sortRows } from "@/lib/utils/table-sort";

describe("compareSortValues", () => {
  it("orders numbers ascending and descending", () => {
    expect(compareSortValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareSortValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareSortValues(2, 2, "asc")).toBe(0);
  });

  it("orders text case-insensitively using Indonesian collation", () => {
    expect(compareSortValues("andi", "Budi", "asc")).toBeLessThan(0);
    expect(compareSortValues("andi", "Budi", "desc")).toBeGreaterThan(0);
  });

  it("orders week strings (ISO dates) chronologically", () => {
    expect(compareSortValues("2026-07-01", "2026-07-08", "asc")).toBeLessThan(0);
    expect(compareSortValues("2026-07-01", "2026-07-08", "desc")).toBeGreaterThan(0);
  });

  it("keeps missing values at the bottom in BOTH directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(compareSortValues(null, 5, dir)).toBeGreaterThan(0);
      expect(compareSortValues(5, null, dir)).toBeLessThan(0);
      expect(compareSortValues(undefined, "a", dir)).toBeGreaterThan(0);
      expect(compareSortValues("", "a", dir)).toBeGreaterThan(0);
      expect(compareSortValues(Number.NaN, 0, dir)).toBeGreaterThan(0);
    }
    expect(compareSortValues(null, undefined, "asc")).toBe(0);
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "andi", gmv: 10 },
    { name: "budi", gmv: null as number | null },
    { name: "citra", gmv: 30 },
    { name: "dewi", gmv: 20 },
  ];

  it("sorts descending with nulls last", () => {
    expect(sortRows(rows, (r) => r.gmv, "desc").map((r) => r.name)).toEqual([
      "citra", "dewi", "andi", "budi",
    ]);
  });

  it("sorts ascending with nulls still last", () => {
    expect(sortRows(rows, (r) => r.gmv, "asc").map((r) => r.name)).toEqual([
      "andi", "dewi", "citra", "budi",
    ]);
  });

  it("is stable for ties and does not mutate the input", () => {
    const tied = [
      { id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 },
    ];
    expect(sortRows(tied, (r) => r.v, "desc").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows[0].name).toBe("andi");
  });
});

describe("nextSortState", () => {
  it("starts a new column at its first direction", () => {
    expect(nextSortState(null, "gmv", "desc")).toEqual({ key: "gmv", dir: "desc" });
    expect(nextSortState({ key: "nama", dir: "asc" }, "gmv", "desc")).toEqual({ key: "gmv", dir: "desc" });
  });

  it("flips direction on the second click of the same column", () => {
    expect(nextSortState({ key: "gmv", dir: "desc" }, "gmv", "desc")).toEqual({ key: "gmv", dir: "asc" });
    expect(nextSortState({ key: "nama", dir: "asc" }, "nama", "asc")).toEqual({ key: "nama", dir: "desc" });
  });

  it("cycles back to the first direction when the table is not resettable", () => {
    expect(nextSortState({ key: "gmv", dir: "asc" }, "gmv", "desc")).toEqual({ key: "gmv", dir: "desc" });
  });

  it("returns to the default order on the third click when resettable", () => {
    expect(nextSortState({ key: "gmv", dir: "asc" }, "gmv", "desc", { resettable: true })).toBeNull();
    expect(
      nextSortState({ key: "gmv", dir: "asc" }, "gmv", "desc", {
        resettable: true,
        fallback: { key: "periode", dir: "desc" },
      })
    ).toEqual({ key: "periode", dir: "desc" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

/**
 * Regression tests for "Refresh Master Shop" (/link-leakage → Master Shop Platform).
 *
 * Two production crashes are pinned here, both of which surfaced to the CM as the
 * censored Next.js message ("An error occurred in the Server Components render"):
 *   1. duplicate Shop ID in one file → a single upsert command touched the same row
 *      twice → Postgres 21000 "ON CONFLICT DO UPDATE command cannot affect row a
 *      second time";
 *   2. the shop list living on a later sheet / below title rows → the old parseSheet()
 *      path read sheet 0 row 0 and reported every row as "shop_id kosong".
 *
 * The action must also never throw: a readable reason has to come back in
 * `report.error`, since Next.js strips thrown messages in production.
 */

const upsertCalls: Record<string, unknown>[][] = [];
let upsertError: { message: string } | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  requirePermission: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001", role: "cm_lead" })),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (rows: Record<string, unknown>[]) => {
        upsertCalls.push(rows);
        // Mirror Postgres: duplicate constrained values inside ONE command fail.
        const ids = rows.map((r) => String(r.shop_id));
        if (new Set(ids).size !== ids.length) {
          return Promise.resolve({
            error: { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" },
          });
        }
        return Promise.resolve({ error: upsertError });
      },
      update: () => ({
        lt: () => Promise.resolve({ error: null }),
        gte: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

import { uploadCooperatingShops } from "../actions";

function sheetFile(aoa: unknown[][], sheetName = "Sheet1", cover = false): File {
  const wb = XLSX.utils.book_new();
  if (cover) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Master MEA"]]), "Cover");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "master.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function formDataWith(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

const HEADER = ["Shop ID", "Shop Name", "Level 2 Categories (Unique)", "Total Collaborated Creators"];

beforeEach(() => {
  upsertCalls.length = 0;
  upsertError = null;
});

describe("uploadCooperatingShops", () => {
  it("dedupes repeated Shop IDs so one upsert never touches a row twice", async () => {
    const file = sheetFile([
      HEADER,
      ["111", "Skintific", "Skincare", "10"],
      ["111", "Skintific Official", "Skincare", "12"],
      ["222", "Somethinc", "Makeup", "3"],
    ]);

    const report = await uploadCooperatingShops(formDataWith(file));

    expect(report.error).toBeUndefined();
    expect(report.inserted).toBe(2);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].map((r) => r.shop_id)).toEqual(["111", "222"]);
    // Last row wins — the platform export puts the freshest values at the bottom.
    expect(upsertCalls[0][0]).toMatchObject({
      shop_name: "Skintific Official",
      total_collaborated_creators: 12,
    });
    expect(report.skipped.map((s) => s.reason).join(" ")).toContain("Shop ID ganda");
  });

  it("finds the shop list on a later sheet under title rows", async () => {
    const file = sheetFile(
      [["MASTER ALL COOPERATING SHOPS"], [], HEADER, ["333", "Wardah", "Skincare", "5"]],
      "All Cooperating Shops",
      true
    );

    const report = await uploadCooperatingShops(formDataWith(file));

    expect(report.error).toBeUndefined();
    expect(report.inserted).toBe(1);
    expect(upsertCalls[0][0]).toMatchObject({ shop_id: "333", shop_name: "Wardah" });
  });

  it("returns a readable error (never throws) when the file is not a shop master", async () => {
    const file = sheetFile([["Brand", "Komisi"], ["Skintific", "5%"]], "Rekap");

    const report = await uploadCooperatingShops(formDataWith(file));

    expect(report.inserted).toBe(0);
    expect(report.error).toMatch(/tidak ada sheet dengan kolom "Shop ID"/);
  });

  it("returns the database message instead of throwing when the upsert fails", async () => {
    upsertError = { message: "permission denied for table cooperating_shops" };
    const file = sheetFile([HEADER, ["444", "Emina", "Makeup", "1"]]);

    const report = await uploadCooperatingShops(formDataWith(file));

    expect(report.inserted).toBe(0);
    expect(report.error).toContain("permission denied for table cooperating_shops");
  });

  it("caps the skipped list so a wrong file cannot balloon the response", async () => {
    const rows = Array.from({ length: 120 }, () => ["", "Tanpa ID", "", ""]);
    const file = sheetFile([HEADER, ...rows, ["555", "Ada ID", "Skincare", "2"]]);

    const report = await uploadCooperatingShops(formDataWith(file));

    expect(report.inserted).toBe(1);
    expect(report.skipped.length).toBeLessThanOrEqual(51);
    expect(report.skipped.at(-1)?.reason).toMatch(/dan \d+ baris lain/);
  });
});

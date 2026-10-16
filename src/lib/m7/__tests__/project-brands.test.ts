import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandProgressTone, parseJoinedDate, parseTargetBrands, projectBrandKey } from "../project-brands";

describe("parseTargetBrands", () => {
  it("kosong = tidak ditargetkan", () => {
    expect(parseTargetBrands("")).toEqual({ ok: true, value: null });
    expect(parseTargetBrands(null)).toEqual({ ok: true, value: null });
    expect(parseTargetBrands("  ")).toEqual({ ok: true, value: null });
  });

  it("bilangan bulat ≥ 1 diterima", () => {
    expect(parseTargetBrands("5")).toEqual({ ok: true, value: 5 });
    expect(parseTargetBrands(" 12 ")).toEqual({ ok: true, value: 12 });
  });

  it("nol, negatif, desimal, teks ditolak", () => {
    for (const raw of ["0", "-1", "2.5", "lima"]) expect(parseTargetBrands(raw).ok, raw).toBe(false);
  });
});

describe("projectBrandKey", () => {
  it("ejaan berbeda brand yang sama → kunci sama", () => {
    expect(projectBrandKey("Wardah Official")).toBe(projectBrandKey("wardah-official"));
    expect(projectBrandKey("  ")).toBeNull();
  });
});

describe("brandProgressTone", () => {
  it("tanpa target netral; kurang = amber; tercapai = hijau", () => {
    expect(brandProgressTone(3, null)).toBe("text-slate-700");
    expect(brandProgressTone(2, 5)).toBe("text-amber-700");
    expect(brandProgressTone(5, 5)).toBe("text-green-700");
  });
});

describe("parseJoinedDate", () => {
  it("hanya tanggal ISO yang benar-benar ada", () => {
    expect(parseJoinedDate("2026-10-16")).toBe("2026-10-16");
    expect(parseJoinedDate("2026-02-30")).toBeNull();
    expect(parseJoinedDate("16/10/2026")).toBeNull();
    expect(parseJoinedDate("")).toBeNull();
  });
});

describe("migrasi 0091 — penjaga CLAUDE.md #9 & apply_migration (K23)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0091_special_project_brands.sql"), "utf8");

  it("tabel baru punya restrictive deny is_creator_user()", () => {
    const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["special_project_brands"]);
    expect(sql).toMatch(/on special_project_brands as restrictive for select\s+using \(not is_creator_user\(\)\)/);
  });

  it("tanpa DROP apa pun", () => {
    expect(sql).not.toMatch(/\bdrop\s+/i);
  });
});

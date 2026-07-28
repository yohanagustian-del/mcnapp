import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildTeamTemplate, TEAM_COLUMNS, TEAM_TEMPLATE_FILENAME } from "../template";
import { ROLE_TEAM_GROUP } from "../roles";
import { ROLES } from "@/lib/rbac";
import { parseSheet } from "@/lib/utils/sheet";

function workbook() {
  return XLSX.read(buildTeamTemplate(), { type: "array" });
}

describe("buildTeamTemplate", () => {
  it("berisi sheet Tim + Petunjuk + Ref Role", () => {
    expect(workbook().SheetNames).toEqual(["Tim", "Petunjuk", "Ref Role"]);
    expect(TEAM_TEMPLATE_FILENAME).toBe("template_tim.xlsx");
  });

  it("header sheet Tim sama persis dengan kolom yang dibaca uploadTeamMembers", () => {
    const header = (
      XLSX.utils.sheet_to_json<string[]>(workbook().Sheets.Tim, { header: 1 })[0] ?? []
    ) as string[];
    // Kunci yang dibaca parser secara langsung (raw.name, raw.email, ...).
    expect(header).toEqual(["name", "email", "role", "team_group", "platform_segment"]);
    expect(header).toEqual(TEAM_COLUMNS.map((c) => c.label));
  });

  it("sheet Petunjuk menandai kolom wajib vs opsional", () => {
    const guide = XLSX.utils.sheet_to_csv(workbook().Sheets.Petunjuk);
    expect(guide).toContain("name,WAJIB");
    expect(guide).toContain("email,WAJIB");
    expect(guide).toContain("role,WAJIB");
    expect(guide).toContain("team_group,opsional");
    expect(guide).toContain("platform_segment,opsional");
  });

  it("sheet Ref Role memuat semua role valid beserta team_group otomatisnya", () => {
    const ref = XLSX.utils.sheet_to_csv(workbook().Sheets["Ref Role"]);
    for (const role of ROLES) expect(ref).toContain(`${role},${ROLE_TEAM_GROUP[role]}`);
  });

  /**
   * Regresi paling penting: template yang diunduh, diisi, lalu diunggah lagi
   * harus terbaca oleh parser upload dengan key yang sama persis. Kalau header
   * template diberi penanda (mis. "name*"), test ini gagal — dan memang harus,
   * karena uploadTeamMembers membaca raw.name secara langsung.
   */
  it("round-trip: template diisi → parseSheet menghasilkan key yang dipakai parser", async () => {
    const wb = workbook();
    XLSX.utils.sheet_add_aoa(wb.Sheets.Tim, [["Netta", "netta@mcn.test", "cpm", "", ""]], {
      origin: "A2",
    });
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], TEAM_TEMPLATE_FILENAME);

    const { rows, errors } = await parseSheet(file);
    expect(errors).toEqual([]);
    expect(rows[0].name).toBe("Netta");
    expect(rows[0].email).toBe("netta@mcn.test");
    expect(rows[0].role).toBe("cpm");
    // team_group dikosongkan di sheet → parser menurunkannya dari role.
    expect(rows[0].team_group).toBe("");
    expect(ROLE_TEAM_GROUP.cpm).toBe("cm");
  });
});

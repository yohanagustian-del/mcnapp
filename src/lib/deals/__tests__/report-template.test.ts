import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildReportCreatorTemplate,
  buildReportSessionTemplate,
  REPORT_CREATOR_COLUMNS,
  REPORT_CREATOR_TEMPLATE_FILENAME,
  REPORT_SESSION_COLUMNS,
  REPORT_SESSION_TEMPLATE_FILENAME,
} from "../report-template";
import { normalizeHeader } from "@/lib/utils/csv";

/**
 * Template hanya berguna kalau file hasil unduh benar-benar bisa diunggah balik.
 * Yang diuji karena itu bukan "ada file .xlsx"-nya, melainkan: header template →
 * normalizeHeader() → kunci yang DIBACA importer (report-actions.ts). Kalau salah
 * satu sisi berganti nama kolom, test inilah yang gagal, bukan user yang menemukannya
 * lewat upload 0 baris.
 */
function headerOf(buffer: ArrayBuffer, sheet: string): string[] {
  const wb = XLSX.read(buffer, { type: "array" });
  return (XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet], { header: 1 })[0] ?? []) as string[];
}

describe("template report performance (per sesi live)", () => {
  it("punya sheet data + Petunjuk", () => {
    const wb = XLSX.read(buildReportSessionTemplate(), { type: "array" });
    expect(wb.SheetNames).toEqual(["Report Performance", "Petunjuk"]);
    expect(REPORT_SESSION_TEMPLATE_FILENAME).toBe("template_report_performance.xlsx");
  });

  it("headernya menghasilkan kunci yang dibaca uploadReportSessions", () => {
    const header = headerOf(buildReportSessionTemplate(), "Report Performance");
    expect(header).toEqual(REPORT_SESSION_COLUMNS.map((c) => c.label));

    const keys = header.map(normalizeHeader);
    // Kunci `pick(...)` di uploadReportSessions.
    for (const key of [
      "nama_creator",
      "tanggal_session_live",
      "event",
      "support_ads",
      "ads_spending",
      "idr",
      "gmv",
      "roas",
    ]) {
      expect(keys).toContain(key);
    }
    // ss_link dibaca lewat pickPrefix("ss_dashboard").
    expect(keys.some((k) => k.startsWith("ss_dashboard"))).toBe(true);
  });

  it("hanya Nama Creator & GMV yang ditandai wajib", () => {
    expect(REPORT_SESSION_COLUMNS.filter((c) => c.required).map((c) => c.label)).toEqual([
      "Nama Creator",
      "GMV",
    ]);
  });
});

describe("template Creator TC & Celeb", () => {
  it("punya sheet data + Petunjuk", () => {
    const wb = XLSX.read(buildReportCreatorTemplate(), { type: "array" });
    expect(wb.SheetNames).toEqual(["Creator TC & Celeb", "Petunjuk"]);
    expect(REPORT_CREATOR_TEMPLATE_FILENAME).toBe("template_creator_tc_celeb.xlsx");
  });

  it("headernya menghasilkan kunci yang dibaca uploadReportCreators", () => {
    const header = headerOf(buildReportCreatorTemplate(), "Creator TC & Celeb");
    expect(header).toEqual(REPORT_CREATOR_COLUMNS.map((c) => c.label));

    const keys = header.map(normalizeHeader);
    for (const key of [
      "username",
      "tipe_kreator",
      "channel",
      "domisili",
      "brand_approval",
      "creator_approval",
      "status_pengiriman",
      "no_resi",
      "notes",
      "link_vt",
      "boost_code",
    ]) {
      expect(keys).toContain(key);
    }
    // Kolom yang dibaca lewat pickPrefix.
    for (const prefix of [
      "link_profile",
      "creator_manager",
      "gmv_l30d",
      "creator_requirement",
      "ratecard_live",
      "ratecard_vt",
      "link_produk",
      "alamat",
      "no_hp",
    ]) {
      expect(keys.some((k) => k.startsWith(prefix))).toBe(true);
    }
  });

  it("hanya Username yang wajib", () => {
    expect(REPORT_CREATOR_COLUMNS.filter((c) => c.required).map((c) => c.label)).toEqual([
      "Username",
    ]);
  });
});

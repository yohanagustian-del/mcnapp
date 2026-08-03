import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildMasterCreatorRow } from "../master-upload";
import { buildCreatorTemplate } from "../import-template";
import { IMPORT_COLUMNS } from "../import-spec";
import { parseSheet } from "@/lib/utils/sheet";

const cmByName = new Map([["elsa yashinta amalia", "uuid-elsa"]]);

/** Baris sheet yang sudah ternormalisasi (huruf kecil, spasi → "_", "*" dibuang). */
function row(over: Record<string, string> = {}): Record<string, string> {
  return { username: "winris12", nama_creator: "Win Ristanti", ...over };
}

describe("buildMasterCreatorRow", () => {
  it("membaca username & CM dari template Import Kreator", () => {
    const out = buildMasterCreatorRow(row({ cm: "Elsa Yashinta Amalia" }), cmByName);
    expect(out.kind).toBe("row");
    if (out.kind !== "row") return;
    expect(out.username).toBe("winris12");
    expect(out.payload.username).toBe("winris12");
    expect(out.payload.owner_cpm_id).toBe("uuid-elsa");
    expect(out.note).toBeNull();
  });

  /** Requirement: nama creator kosong TIDAK boleh membatalkan baris. */
  it("Nama Creator kosong → tetap masuk, nama diambil dari username", () => {
    const out = buildMasterCreatorRow(row({ nama_creator: "" }), cmByName);
    expect(out.kind).toBe("row");
    if (out.kind !== "row") return;
    expect(out.name).toBe("winris12");
    expect(out.payload.name).toBe("winris12");
  });

  /** Requirement: username kosong → jangan dimasukkan. */
  it("Username kosong → baris ditolak walau Nama Creator terisi", () => {
    const out = buildMasterCreatorRow(row({ username: "" }), cmByName);
    expect(out).toEqual({ kind: "skip", reason: "Username kosong — baris tidak bisa dicocokkan" });
  });

  it("baris kosong dilewati diam-diam, bukan dilaporkan sebagai error", () => {
    expect(buildMasterCreatorRow({ username: "", nama_creator: "  " }, cmByName)).toEqual({
      kind: "empty",
    });
  });

  it("CM tidak terdaftar → baris tetap disimpan tanpa CM, dengan catatan review", () => {
    const out = buildMasterCreatorRow(row({ cm: "Nama Ngasal" }), cmByName);
    expect(out.kind).toBe("row");
    if (out.kind !== "row") return;
    expect(out.payload.owner_cpm_id).toBeUndefined();
    expect(out.note).toContain("Nama Ngasal");
  });

  /** Kolom CM tidak ada di sheet tidak boleh MENGOSONGKAN CM yang sudah ada. */
  it("kolom CM kosong → owner_cpm_id tidak ikut ditulis", () => {
    const out = buildMasterCreatorRow(row(), cmByName);
    expect(out.kind).toBe("row");
    if (out.kind !== "row") return;
    expect("owner_cpm_id" in out.payload).toBe(false);
  });

  it("kolom template lain terbaca: End Date, Kategory, Kualitas, Rate Card", () => {
    const out = buildMasterCreatorRow(
      row({
        end_date: "2026-08-14",
        join_date: "2026-05-17",
        kategory: "Video Creator",
        kualitas: "Bagus",
        rate_card: "Rp1.500.000",
        platform: "Tiktok",
      }),
      cmByName
    );
    expect(out.kind).toBe("row");
    if (out.kind !== "row") return;
    expect(out.payload.contract_end_date).toBe("2026-08-14");
    expect(out.payload.join_date).toBe("2026-05-17");
    expect(out.payload.jenis_creator).toBe("Video Creator");
    expect(out.payload.content_quality).toBe("Bagus");
    expect(out.payload.rate_card).toBe(1_500_000);
    expect(out.payload.platform).toBe("tiktok");
  });

  /** Header sheet master lama harus tetap jalan setelah alias template ditambahkan. */
  it("tetap membaca header sheet master lama", () => {
    const out = buildMasterCreatorRow(
      {
        username: "winris12",
        end_date_kontrak_tertulis: "19 February 2026",
        kualitas_konten: "Cukup",
        jenis_creator: "Live Creator",
      },
      cmByName
    );
    expect(out.kind).toBe("row");
    if (out.kind !== "row") return;
    expect(out.payload.contract_end_date).toBe("2026-02-19");
    expect(out.payload.content_quality).toBe("Cukup");
    expect(out.payload.jenis_creator).toBe("Live Creator");
  });

  /** commission_share read-only (CLAUDE.md #3) — tidak boleh masuk lewat form ini. */
  it("Sharing Komisi di sheet TIDAK pernah ditulis ke commission_share", () => {
    const out = buildMasterCreatorRow(row({ sharing_komisi: "0.1" }), cmByName);
    expect(out.kind).toBe("row");
    if (out.kind !== "row") return;
    expect("commission_share" in out.payload).toBe(false);
  });

  it("status tidak dikenal / kosong → prospek untuk baris insert", () => {
    const bad = buildMasterCreatorRow(row({ status: "entah" }), cmByName);
    const empty = buildMasterCreatorRow(row(), cmByName);
    const ok = buildMasterCreatorRow(row({ status: "aktif" }), cmByName);
    expect(bad.kind === "row" && bad.insertStatus).toBe("prospek");
    expect(empty.kind === "row" && empty.insertStatus).toBe("prospek");
    expect(ok.kind === "row" && ok.insertStatus).toBe("aktif");
  });
});

/**
 * Regresi end-to-end paling penting: template Import Kreator yang diunduh lalu
 * diunggah ke form "Upload Master Data Creator" harus terbaca utuh. Sebelum
 * perbaikan, header "Username*" / "CM*" tidak pernah cocok sehingga username &
 * CM masuk kosong dan baris tanpa Nama Creator ditolak.
 */
describe("template Import Kreator → form Upload Master Data Creator", () => {
  it("round-trip: username, CM, dan baris tanpa Nama Creator terbaca", async () => {
    const wb = XLSX.read(buildCreatorTemplate(["Elsa Yashinta Amalia"]), { type: "array" });
    const header = IMPORT_COLUMNS.map((c) => c.label);
    const fill = (over: Record<string, string>) =>
      header.map((label) => over[label] ?? "");

    XLSX.utils.sheet_add_aoa(
      wb.Sheets.Kreator,
      [
        fill({
          "Username*": "winris12",
          "CM*": "Elsa Yashinta Amalia",
          "Nama Creator": "Win Ristanti",
          "End Date": "2026-08-14",
        }),
        // Nama Creator sengaja dikosongkan — harus tetap masuk.
        fill({ "Username*": "derizagroup", "CM*": "Elsa Yashinta Amalia" }),
        // Username kosong — harus ditolak.
        fill({ "Nama Creator": "Tanpa Username" }),
      ],
      { origin: "A2" }
    );

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "template_kreator.xlsx");
    const { rows, errors } = await parseSheet(file);
    expect(errors).toEqual([]);

    const outcomes = rows.map((r) => buildMasterCreatorRow(r, cmByName));
    const kept = outcomes.filter((o) => o.kind === "row");
    expect(kept).toHaveLength(2);
    expect(kept.map((o) => (o.kind === "row" ? o.username : ""))).toEqual([
      "winris12",
      "derizagroup",
    ]);
    expect(kept.every((o) => o.kind === "row" && o.payload.owner_cpm_id === "uuid-elsa")).toBe(true);
    expect(kept[1].kind === "row" && kept[1].name).toBe("derizagroup");
    expect(kept[0].kind === "row" && kept[0].payload.contract_end_date).toBe("2026-08-14");

    expect(outcomes.filter((o) => o.kind === "skip")).toEqual([
      { kind: "skip", reason: "Username kosong — baris tidak bisa dicocokkan" },
    ]);
  });
});

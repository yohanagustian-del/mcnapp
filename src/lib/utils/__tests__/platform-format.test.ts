import { describe, expect, it } from "vitest";
import { parseCsv, isSummaryRow } from "../csv";
import { parseFlexibleDate, parsePeriodRange } from "../date";
import { parseRupiah } from "../rupiah";

/** QA batch 2: real platform export format (;-delimited, Indonesian headers). */
describe("real platform export format", () => {
  it("parses semicolon-delimited export with Indonesian headers", () => {
    const text = [
      "Tanggal;Nama pengguna kreator;ID Produk;ID Toko;GMV Afiliasi;GMV LIVE Afiliasi",
      "Ringkasan;-;-;-;Rp2.411.927.669;Rp2.318.296.428",
      "2026-06-01-2026-06-30;vikahere;1729599269350705010;7494929988145220466;Rp218.080.682;Rp217.468.343",
    ].join("\n");
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(isSummaryRow(rows[0])).toBe(true); // "Ringkasan"
    expect(isSummaryRow(rows[1])).toBe(false);
    expect(rows[1]["nama_pengguna_kreator"]).toBe("vikahere");
    expect(rows[1]["id_produk"]).toBe("1729599269350705010");
    expect(parseRupiah(rows[1]["gmv_afiliasi"])).toBe(218_080_682);
    expect(parsePeriodRange(rows[1]["tanggal"])).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
  });

  it("parses abbreviated & dashed textual dates from legacy sheets", () => {
    expect(parseFlexibleDate("9 Sep 2024")).toBe("2024-09-09");
    expect(parseFlexibleDate("11-Dec-2026")).toBe("2026-12-11");
    expect(parseFlexibleDate("30 Jun 2024")).toBe("2024-06-30");
  });

  it("slash dates: day-first default, month-first fallback (BD US sheets)", () => {
    expect(parseFlexibleDate("25/06/2026")).toBe("2026-06-25"); // dd/mm
    expect(parseFlexibleDate("04/21/2026")).toBe("2026-04-21"); // mm/dd (21 bukan bulan)
    expect(parseFlexibleDate("02/07/2026")).toBe("2026-07-02"); // ambigu → dd/mm (ID)
  });

  it("parses BD report money formats", () => {
    expect(parseRupiah("Rp1,296,097")).toBe(1_296_097); // koma ribuan
    expect(parseRupiah("Rp14.626.698")).toBe(14_626_698); // titik ribuan
  });
});

import { describe, it, expect } from "vitest";
import {
  buildImportRows,
  summarize,
  canonicalHeader,
  IMPORT_COLUMNS,
  type ImportContext,
} from "../import-spec";

function ctx(overrides?: Partial<ImportContext>): ImportContext {
  return {
    cmByName: new Map([
      ["netta", { id: "uuid-netta", name: "Netta" }],
      ["gabriel", { id: "uuid-gabriel", name: "Gabriel" }],
    ]),
    existingByUsername: new Map([["vikahere", { id: "CRT-AAAAA", cmName: "Gabriel" }]]),
    ...overrides,
  };
}

describe("canonicalHeader", () => {
  it("menyamakan variasi penulisan header", () => {
    expect(canonicalHeader("Username*")).toBe("username");
    expect(canonicalHeader("no_hp")).toBe("nohp");
    expect(canonicalHeader("No. HP")).toBe("nohp");
    expect(canonicalHeader("Rate Card")).toBe("ratecard");
  });
});

describe("buildImportRows", () => {
  it("username baru → insert, username lama → update dengan CM diganti", () => {
    const rows = buildImportRows(
      [
        { username: "richannelvt", cm: "Netta" },
        { username: "vikahere", cm: "Netta" },
      ],
      ctx()
    );

    expect(rows[0].status).toBe("insert");
    expect(rows[0].existingId).toBeNull();
    expect(rows[0].payload.owner_cpm_id).toBe("uuid-netta");

    expect(rows[1].status).toBe("update");
    expect(rows[1].existingId).toBe("CRT-AAAAA");
    expect(rows[1].previousCmName).toBe("Gabriel");
    // Replace, bukan append: owner_cpm_id ikut payload update.
    expect(rows[1].payload.owner_cpm_id).toBe("uuid-netta");
  });

  it("menolak baris dengan username atau CM kosong", () => {
    const rows = buildImportRows(
      [
        { username: "", cm: "Netta" },
        { username: "abahrumahan", cm: "" },
      ],
      ctx()
    );
    expect(rows.map((r) => r.status)).toEqual(["error", "error"]);
    expect(rows[0].errors[0]).toMatch(/Username wajib/);
    expect(rows[1].errors[0]).toMatch(/CM wajib/);
  });

  it("menolak CM yang tidak terdaftar di Tim", () => {
    const rows = buildImportRows([{ username: "uda.arbi", cm: "Siapa" }], ctx());
    expect(rows[0].status).toBe("error");
    expect(rows[0].errors[0]).toMatch(/tidak terdaftar/);
  });

  it("menandai username duplikat di dalam file", () => {
    const rows = buildImportRows(
      [
        { username: "cicispill89", cm: "Netta" },
        { username: "cicispill89", cm: "Gabriel" },
      ],
      ctx()
    );
    expect(rows[0].status).toBe("insert");
    expect(rows[1].status).toBe("error");
    expect(rows[1].errors[0]).toMatch(/duplikat/);
  });

  it("mencocokkan username tanpa peduli besar-kecil huruf dan spasi berlebih", () => {
    const rows = buildImportRows([{ username: " VikaHere ", cm: "netta" }], ctx());
    expect(rows[0].status).toBe("update");
    expect(rows[0].existingId).toBe("CRT-AAAAA");
    // Nama CM dinormalisasi ke ejaan resmi di team_members.
    expect(rows[0].cmName).toBe("Netta");
  });

  it("kolom opsional kosong tidak masuk payload (tidak menimpa data lama)", () => {
    const rows = buildImportRows([{ username: "vikahere", cm: "Netta", "no_hp": "" }], ctx());
    expect(rows[0].payload).not.toHaveProperty("phone");
    expect(Object.keys(rows[0].payload).sort()).toEqual(["owner_cpm_id", "username"]);
  });

  it("memetakan kolom opsional yang terisi", () => {
    const rows = buildImportRows(
      [
        {
          username: "lenasahara1",
          cm: "Netta",
          kategory: "Live Creator",
          "nama_creator": "Lena Sahara",
          "no_hp": "08123",
          level: "Lv 3",
          "rate_card": "Rp1.500.000",
          domisili: "Bandung",
          "alamat_lengkap": "Jl. Merdeka No. 10, Sukajadi, Bandung 40161",
          platform: "tiktok",
        },
      ],
      ctx()
    );
    const p = rows[0].payload;
    expect(p.jenis_creator).toBe("Live Creator");
    expect(p.name).toBe("Lena Sahara");
    expect(p.phone).toBe("08123");
    expect(p.level).toBe(3);
    expect(p.rate_card).toBe(1_500_000);
    expect(p.domisili).toBe("Bandung");
    expect(p.alamat).toBe("Jl. Merdeka No. 10, Sukajadi, Bandung 40161");
    expect(p.platform).toBe("tiktok");
  });

  /** Join Date + End Date = dasar hitung Sisa Kontrak di tabel kreator. */
  it("memetakan Join Date & End Date ke tanggal kontrak", () => {
    const rows = buildImportRows(
      [
        {
          username: "vikahere",
          cm: "Netta",
          "join_date": "2026-01-31",
          "end_date": "31 January 2027",
        },
      ],
      ctx()
    );
    expect(rows[0].payload.join_date).toBe("2026-01-31");
    expect(rows[0].payload.contract_end_date).toBe("2027-01-31");
  });

  it("End Date kosong tidak masuk payload (tidak menghapus tanggal lama)", () => {
    const rows = buildImportRows(
      [{ username: "vikahere", cm: "Netta", "end_date": "" }],
      ctx()
    );
    expect(rows[0].payload).not.toHaveProperty("contract_end_date");
  });

  /** Header sheet master lama tetap terbaca ke kolom End Date yang sama. */
  it("menerima header End Date versi sheet master lama", () => {
    const rows = buildImportRows(
      [{ username: "vikahere", cm: "Netta", "end_date_kontrak_tertulis": "2027-03-01" }],
      ctx()
    );
    expect(rows[0].payload.contract_end_date).toBe("2027-03-01");
  });

  /**
   * Niche dihapus dari template — diisi otomatis dari upload data platform
   * mingguan, jadi kolom "niche" di file lama pun tidak boleh menimpanya.
   */
  it("tidak ada kolom Niche di template dan niche di file diabaikan", () => {
    expect(IMPORT_COLUMNS.map((c) => c.label)).not.toContain("Niche");
    const rows = buildImportRows(
      [{ username: "vikahere", cm: "Netta", niche: "beauty; skincare" }],
      ctx()
    );
    expect(rows[0].payload).not.toHaveProperty("niche");
    expect(rows[0].payload).not.toHaveProperty("top_niches");
  });

  it("summarize menghitung insert / update / error", () => {
    const rows = buildImportRows(
      [
        { username: "baru1", cm: "Netta" },
        { username: "vikahere", cm: "Netta" },
        { username: "baru2", cm: "TidakAda" },
      ],
      ctx()
    );
    expect(summarize(rows)).toEqual({ insert: 1, update: 1, error: 1 });
  });
});

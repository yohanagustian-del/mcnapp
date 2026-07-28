import { describe, it, expect } from "vitest";
import { buildImportRows, summarize, canonicalHeader, type ImportContext } from "../import-spec";

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
          niche: "beauty; skincare, fashion, extra",
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
    expect(p.top_niches).toEqual(["beauty", "skincare", "fashion"]);
    expect(p.platform).toBe("tiktok");
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

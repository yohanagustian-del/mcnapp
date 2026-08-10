import { describe, it, expect } from "vitest";
import {
  buildImportRows,
  summarize,
  canonicalHeader,
  parseSharePercent,
  resolveCommissionShare,
  IMPORT_COLUMNS,
  type ImportContext,
} from "../import-spec";

function ctx(overrides?: Partial<ImportContext>): ImportContext {
  return {
    cmByName: new Map([
      ["netta", { id: "uuid-netta", name: "Netta" }],
      ["gabriel", { id: "uuid-gabriel", name: "Gabriel" }],
    ]),
    acquisitorByName: new Map([["rani", { id: "uuid-rani", name: "Rani" }]]),
    existingByUsername: new Map([
      ["vikahere", { id: "CRT-AAAAA", cmName: "Gabriel", commissionShare: null }],
      // Kreator yang sharing komisinya SUDAH terisi — sheet tidak boleh menimpanya.
      ["sharedcreator", { id: "CRT-BBBBB", cmName: "Netta", commissionShare: 0.22 }],
    ]),
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

  it("kolom Akuisitor di-resolve ke team_members.id", () => {
    const rows = buildImportRows([{ username: "uda.arbi", cm: "Netta", akuisitor: "rani" }], ctx());
    expect(rows[0].status).toBe("insert");
    expect(rows[0].payload.acquisitor_id).toBe("uuid-rani");
    expect(rows[0].warnings).toEqual([]);
  });

  it("Akuisitor tak terdaftar = peringatan, bukan error — baris tetap tersimpan", () => {
    const rows = buildImportRows(
      [{ username: "uda.arbi", cm: "Netta", akuisitor: "Siapa" }],
      ctx()
    );
    expect(rows[0].status).toBe("insert");
    expect(rows[0].payload).not.toHaveProperty("acquisitor_id");
    expect(rows[0].warnings[0]).toMatch(/Akuisitor "Siapa" tidak terdaftar/);
  });

  it("Akuisitor kosong tidak masuk payload (akuisitor lama tidak terhapus)", () => {
    const rows = buildImportRows([{ username: "vikahere", cm: "Netta", akuisitor: "" }], ctx());
    expect(rows[0].payload).not.toHaveProperty("acquisitor_id");
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

  it("memetakan kolom Kualitas ke content_quality", () => {
    const rows = buildImportRows(
      [{ username: "vikahere", cm: "Netta", kualitas: "Bagus" }],
      ctx()
    );
    expect(rows[0].payload.content_quality).toBe("Bagus");
  });

  it("menerima header 'Kualitas Konten' dari sheet master lama", () => {
    const rows = buildImportRows(
      [{ username: "vikahere", cm: "Netta", "kualitas_konten": "Cukup" }],
      ctx()
    );
    expect(rows[0].payload.content_quality).toBe("Cukup");
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

describe("parseSharePercent", () => {
  it("menerima persen, fraksi, dan koma desimal", () => {
    expect(parseSharePercent("22%")).toBe(0.22);
    expect(parseSharePercent("22")).toBe(0.22);
    expect(parseSharePercent("0,22")).toBe(0.22);
    expect(parseSharePercent("0.22")).toBe(0.22);
    expect(parseSharePercent("22,5%")).toBe(0.225);
    expect(parseSharePercent(" 30 % ")).toBe(0.3);
  });

  it("menolak nilai kotor / di luar rentang, bukan memaksanya jadi angka", () => {
    for (const bad of ["", "  ", "not found", "error", "5-7%", "0", "-10%", "150%", "abc"]) {
      expect(parseSharePercent(bad)).toBeNull();
    }
  });

  it("100% masih diterima sebagai batas atas", () => {
    expect(parseSharePercent("100%")).toBe(1);
    expect(parseSharePercent("1")).toBe(1);
  });
});

describe("resolveCommissionShare — isi kalau kosong saja (CLAUDE.md #3)", () => {
  it("mengisi saat sharing di sistem masih kosong", () => {
    expect(resolveCommissionShare("22%", null)).toEqual({ value: 0.22, warning: null, alert: null });
    // Kreator baru (belum ada di DB) → undefined, ikut diisi.
    expect(resolveCommissionShare("22%", undefined).value).toBe(0.22);
  });

  it("TIDAK menimpa nilai yang sudah ada, dan mengembalikan alert", () => {
    const r = resolveCommissionShare("15%", 0.22);
    expect(r.value).toBeNull();
    expect(r.alert).toEqual({ from: 0.22, to: 0.15 });
    expect(r.warning).toContain("TIDAK ditimpa");
  });

  /** Naik pun tidak ditimpa: sumber kebenaran tetap platform, bukan sheet. */
  it("nilai lebih besar juga tidak ditimpa (tetap alert)", () => {
    const r = resolveCommissionShare("30%", 0.22);
    expect(r.value).toBeNull();
    expect(r.alert).toEqual({ from: 0.22, to: 0.3 });
  });

  it("nilai sama = tanpa tulis, tanpa alert", () => {
    expect(resolveCommissionShare("22%", 0.22)).toEqual({ value: null, warning: null, alert: null });
  });

  it("kolom kosong tidak menghasilkan apa pun", () => {
    expect(resolveCommissionShare("", 0.22)).toEqual({ value: null, warning: null, alert: null });
    expect(resolveCommissionShare("", null)).toEqual({ value: null, warning: null, alert: null });
  });

  it("nilai tidak valid = warning, bukan crash dan bukan alert", () => {
    const r = resolveCommissionShare("not found", null);
    expect(r.value).toBeNull();
    expect(r.alert).toBeNull();
    expect(r.warning).toContain("tidak dikenali");
  });
});

describe("Sharing Komisi lewat buildImportRows", () => {
  it("kreator baru: sharing dari sheet masuk payload", () => {
    const rows = buildImportRows(
      [{ username: "kreatorbaru", cm: "Netta", "sharing_komisi": "18%" }],
      ctx()
    );
    expect(rows[0].status).toBe("insert");
    expect(rows[0].payload.commission_share).toBe(0.18);
    expect(rows[0].warnings).toEqual([]);
    expect(rows[0].commissionAlert).toBeNull();
  });

  it("kreator lama yang sharing-nya kosong: ikut diisi (backfill)", () => {
    const rows = buildImportRows(
      [{ username: "vikahere", cm: "Netta", "sharing_komisi": "25%" }],
      ctx()
    );
    expect(rows[0].status).toBe("update");
    expect(rows[0].payload.commission_share).toBe(0.25);
  });

  it("kreator lama yang sharing-nya sudah terisi: payload bersih + alert", () => {
    const rows = buildImportRows(
      [{ username: "sharedcreator", cm: "Netta", "sharing_komisi": "15%" }],
      ctx()
    );
    expect(rows[0].payload).not.toHaveProperty("commission_share");
    expect(rows[0].commissionAlert).toEqual({ from: 0.22, to: 0.15 });
    expect(rows[0].warnings).toHaveLength(1);
    // Baris tetap tersimpan (bukan error) — hanya sharing-nya yang diabaikan.
    expect(rows[0].status).toBe("update");
  });

  it("tanpa kolom Sharing Komisi, commission_share tidak pernah disentuh", () => {
    const rows = buildImportRows([{ username: "sharedcreator", cm: "Netta" }], ctx());
    expect(rows[0].payload).not.toHaveProperty("commission_share");
    expect(rows[0].commissionAlert).toBeNull();
  });
});

describe("Kelas Kreator lewat buildImportRows", () => {
  it("nilai dari sheet dipetakan ke creator_class", () => {
    const rows = buildImportRows(
      [
        { username: "baru1", cm: "Netta", "kelas_kreator": "Kreator Prioritas" },
        { username: "baru2", cm: "Netta", "kelas_kreator": "influencer" },
      ],
      ctx()
    );
    expect(rows[0].payload.creator_class).toBe("top_creator");
    expect(rows[1].payload.creator_class).toBe("influencer");
    expect(rows[0].warnings).toEqual([]);
  });

  /** Requirement: upload dengan kolom kosong → Reguler. */
  it("kreator BARU dengan kelas kosong → reguler", () => {
    const rows = buildImportRows(
      [
        { username: "baru1", cm: "Netta", "kelas_kreator": "" },
        { username: "baru2", cm: "Netta" },
      ],
      ctx()
    );
    expect(rows[0].payload.creator_class).toBe("reguler");
    expect(rows[1].payload.creator_class).toBe("reguler");
  });

  /**
   * Kreator yang sudah ada TIDAK diturunkan ke Reguler hanya karena selnya kosong —
   * aturan umum template: kolom opsional kosong tidak menimpa data lama.
   */
  it("kreator LAMA dengan kelas kosong: creator_class tidak disentuh", () => {
    const rows = buildImportRows([{ username: "vikahere", cm: "Netta" }], ctx());
    expect(rows[0].status).toBe("update");
    expect(rows[0].payload).not.toHaveProperty("creator_class");
  });

  it("kreator LAMA dengan kelas terisi tetap di-update", () => {
    const rows = buildImportRows(
      [{ username: "vikahere", cm: "Netta", "kelas_kreator": "Kreator Prioritas" }],
      ctx()
    );
    expect(rows[0].payload.creator_class).toBe("top_creator");
  });

  /** Sheet lama masih menulis istilah sebelum rename label. */
  it('label lama "Top Creator" tetap dipetakan ke top_creator', () => {
    const rows = buildImportRows(
      [{ username: "baru1", cm: "Netta", "kelas_kreator": "Top Creator" }],
      ctx()
    );
    expect(rows[0].payload.creator_class).toBe("top_creator");
    expect(rows[0].warnings).toEqual([]);
  });

  it("nilai tidak dikenali = warning, baris tetap tersimpan", () => {
    const baru = buildImportRows(
      [{ username: "baru1", cm: "Netta", "kelas_kreator": "VIP" }],
      ctx()
    );
    expect(baru[0].status).toBe("insert");
    expect(baru[0].payload.creator_class).toBe("reguler");
    expect(baru[0].warnings[0]).toContain("tidak dikenali");
    expect(baru[0].warnings[0]).toContain("Reguler");

    const lama = buildImportRows(
      [{ username: "vikahere", cm: "Netta", "kelas_kreator": "VIP" }],
      ctx()
    );
    expect(lama[0].payload).not.toHaveProperty("creator_class");
    expect(lama[0].warnings[0]).toContain("kelas lama dipertahankan");
  });
});

describe("kolom template", () => {
  it("berisi Sharing Komisi, Kualitas & Kelas Kreator, tanpa Niche", () => {
    const labels = IMPORT_COLUMNS.map((c) => c.label);
    expect(labels).toContain("Sharing Komisi");
    expect(labels).toContain("Kualitas");
    expect(labels).toContain("Kelas Kreator");
    expect(labels).not.toContain("Niche");
  });

  it("Kelas Kreator tepat setelah Kategory, dan notenya menyebut ketiga pilihan", () => {
    const labels = IMPORT_COLUMNS.map((c) => c.label);
    expect(labels[labels.indexOf("Kategory") + 1]).toBe("Kelas Kreator");
    const note = IMPORT_COLUMNS.find((c) => c.label === "Kelas Kreator")!.note;
    for (const opsi of ["Reguler", "Kreator Prioritas", "Influencer"]) {
      expect(note).toContain(opsi);
    }
  });

  it("Kualitas tepat setelah Followers, Sharing Komisi tepat sebelum RC Live", () => {
    const labels = IMPORT_COLUMNS.map((c) => c.label);
    expect(labels[labels.indexOf("Followers") + 1]).toBe("Kualitas");
    expect(labels[labels.indexOf("Sharing Komisi") + 1]).toBe("RC Live");
  });

  it("End Date tepat setelah Join Date, Alamat Lengkap tepat setelah Domisili", () => {
    const labels = IMPORT_COLUMNS.map((c) => c.label);
    expect(labels[labels.indexOf("Join Date") + 1]).toBe("End Date");
    expect(labels[labels.indexOf("Domisili") + 1]).toBe("Alamat Lengkap");
  });
});

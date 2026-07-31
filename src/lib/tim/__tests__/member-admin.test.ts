import { describe, it, expect } from "vitest";
import {
  BLOCKING_REFERENCES,
  EDITABLE_FIELDS,
  diffMember,
  formatBlockingMessage,
  formatForeignKeyError,
  formatIssues,
  memberCreateSchema,
  memberLabel,
  memberUpdateSchema,
  readMemberFields,
  summarizeProposal,
} from "../member-admin";
import {
  generateTempPassword,
  TEMP_PASSWORD_CHARSET,
  TEMP_PASSWORD_LENGTH,
} from "../temp-password";

/** FormData tiruan ringan — readMemberFields hanya butuh .get(). */
function form(fields: Record<string, string>) {
  return { get: (name: string) => (name in fields ? fields[name] : null) };
}

describe("field yang boleh diedit", () => {
  it("tidak pernah memuat email — email = identitas login, bukan data profil", () => {
    expect(EDITABLE_FIELDS).not.toContain("email");
    expect(EDITABLE_FIELDS).toEqual(["name", "role", "team_group", "platform_segment", "active"]);
  });

  it("skema update menolak field email walau dikirim", () => {
    const parsed = memberUpdateSchema.parse({
      name: "Rina",
      email: "penyusup@mea.co.id",
      role: "cpm",
      team_group: "cm",
      platform_segment: null,
      active: true,
    } as never);
    expect(parsed).not.toHaveProperty("email");
  });
});

describe("readMemberFields", () => {
  it("menurunkan divisi dari jabatan saat team_group dikosongkan", () => {
    const raw = readMemberFields(form({ name: "Budi", role: "bizdev_lead", team_group: "" }));
    expect(raw.team_group).toBe("bizdev");
  });

  it("menghormati divisi yang diisi manual (override)", () => {
    const raw = readMemberFields(form({ name: "Budi", role: "cpm", team_group: "management" }));
    expect(raw.team_group).toBe("management");
  });

  it("menormalkan jabatan ke huruf kecil dan segmen kosong jadi null", () => {
    const raw = readMemberFields(form({ name: "Sri", role: "  CPM  ", platform_segment: "" }));
    expect(raw.role).toBe("cpm");
    expect(raw.platform_segment).toBeNull();
  });

  it("membaca status aktif; default aktif kalau kolomnya tidak ada", () => {
    expect(readMemberFields(form({ active: "false" })).active).toBe(false);
    expect(readMemberFields(form({})).active).toBe(true);
  });
});

describe("validasi", () => {
  it("menerima anggota baru yang benar dan menormalkan email", () => {
    const parsed = memberCreateSchema.safeParse(
      readMemberFields(
        form({ name: "Dewi Lestari", email: "  Dewi@MEA.co.id ", role: "cm_lead", team_group: "" })
      )
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("dewi@mea.co.id");
      expect(parsed.data.team_group).toBe("cm");
    }
  });

  it("menolak jabatan yang tidak dikenal dengan pesan Bahasa Indonesia", () => {
    const parsed = memberCreateSchema.safeParse(
      readMemberFields(form({ name: "Dewi", email: "d@mea.co.id", role: "cm" }))
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(formatIssues(parsed.error)).toContain("Jabatan");
  });

  it("menolak email tanpa format yang benar", () => {
    const parsed = memberCreateSchema.safeParse(
      readMemberFields(form({ name: "Dewi", email: "bukan-email", role: "cpm" }))
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(formatIssues(parsed.error)).toContain("Email");
  });
});

describe("diffMember", () => {
  const before = {
    name: "Sinta",
    role: "cpm",
    team_group: "cm",
    platform_segment: "tiktok",
    active: true,
  };

  it("mencatat ganti jabatan dengan label yang terbaca manusia", () => {
    const changes = diffMember(before, { ...before, role: "cm_lead" });
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("role");
    expect(changes[0].from).toBe("CPM (Creator Manager)");
    expect(changes[0].to).toBe("CM Lead");
  });

  it("menerjemahkan status aktif jadi Aktif/Nonaktif", () => {
    const changes = diffMember(before, { ...before, active: false });
    expect(changes[0]).toMatchObject({ field: "active", from: "Aktif", to: "Nonaktif" });
  });

  it("kosong kalau tidak ada yang berubah", () => {
    expect(diffMember(before, { ...before })).toEqual([]);
  });

  it("mengabaikan field di luar daftar yang boleh diedit", () => {
    expect(diffMember(before, { ...before, email: "baru@mea.co.id" } as never)).toEqual([]);
  });

  it("menampilkan em dash untuk nilai kosong", () => {
    const changes = diffMember({ ...before, platform_segment: null }, { ...before });
    expect(changes[0].from).toBe("—");
    expect(changes[0].to).toBe("tiktok");
  });
});

describe("penolakan hapus permanen", () => {
  it("menyebut persis data apa yang menghalangi, bukan sekadar 'gagal'", () => {
    const msg = formatBlockingMessage("Sinta", [
      { label: "riwayat upload data platform", count: 3 },
      { label: "slot jadwal live yang dibuat", count: 12 },
    ]);
    expect(msg).toContain("3 riwayat upload data platform");
    expect(msg).toContain("12 slot jadwal live yang dibuat");
    expect(msg).toContain("Nonaktifkan");
  });

  it("mengabaikan tabel yang jumlahnya nol", () => {
    const msg = formatBlockingMessage("Sinta", [
      { label: "riwayat upload data platform", count: 0 },
      { label: "slot jadwal live yang dibuat", count: 2 },
    ]);
    expect(msg).not.toContain("riwayat upload");
    expect(msg).toContain("2 slot jadwal live");
  });

  it("mengizinkan hapus (pesan kosong) saat tidak ada yang menghalangi", () => {
    expect(
      formatBlockingMessage("Sinta", [
        { label: "riwayat upload data platform", count: 0 },
        { label: "slot jadwal live yang dibuat", count: 0 },
      ])
    ).toBe("");
  });

  // Diverifikasi terhadap pg_constraint di DB nyata: hanya 4 FK NOT NULL yang menunjuk
  // team_members, dan tool_usage_logs.member_id (telemetri) di-CASCADE, bukan diblokir.
  it("memuat tepat FK NOT NULL yang berupa catatan bisnis", () => {
    expect(BLOCKING_REFERENCES.map((r) => `${r.table}.${r.column}`)).toEqual([
      "metric_upload_batches.uploaded_by",
      "live_schedule_slots.created_by",
      "project_manpower.member_id",
    ]);
  });

  it("tidak memblokir telemetri page-view — itu ikut terhapus, bukan penghalang", () => {
    expect(BLOCKING_REFERENCES.map((r) => r.table)).not.toContain("tool_usage_logs");
  });

  it("punya pesan cadangan kalau FK penghalangnya di luar daftar", () => {
    const msg = formatForeignKeyError("Sinta", 'violates foreign key "tabel_baru_fkey"');
    expect(msg).toContain("tabel_baru_fkey");
    expect(msg).toContain("Nonaktifkan");
  });
});

describe("password sementara", () => {
  it("panjangnya tetap dan hanya memakai charset tanpa karakter ambigu", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toHaveLength(TEMP_PASSWORD_LENGTH);
      for (const ch of pw) expect(TEMP_PASSWORD_CHARSET).toContain(ch);
    }
  });

  it("tidak pernah memuat karakter yang mudah keliru saat didikte (0 O 1 l I)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it("selalu memuat huruf kecil, huruf besar, angka, dan simbol", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%*?]/);
    }
  });

  it("tidak menaruh kelas karakter di posisi tetap (hasil diacak)", () => {
    const firstChars = new Set(Array.from({ length: 100 }, () => generateTempPassword()[0]));
    expect(firstChars.size).toBeGreaterThan(5);
  });

  it("praktis tidak pernah berulang", () => {
    const seen = new Set(Array.from({ length: 300 }, () => generateTempPassword()));
    expect(seen.size).toBe(300);
  });
});

describe("ringkasan usulan OD", () => {
  it("merangkum usulan tambah user", () => {
    const text = summarizeProposal("create", "—", {
      name: "Andi",
      email: "andi@mea.co.id",
      role: "bizdev",
    });
    expect(text).toBe("Tambah Andi (andi@mea.co.id) sebagai BizDev");
  });

  it("merangkum usulan ganti jabatan pakai label, bukan kode enum", () => {
    const text = summarizeProposal("update", "Sinta (sinta@mea.co.id)", {
      role: "cm_lead",
      team_group: "cm",
    });
    expect(text).toContain("Sinta (sinta@mea.co.id)");
    expect(text).toContain("Jabatan → CM Lead");
    expect(text).not.toContain("cm_lead");
  });

  it("merangkum usulan nonaktif dan hapus", () => {
    expect(summarizeProposal("deactivate", "Sinta (s@mea.co.id)", {})).toBe(
      "Nonaktifkan Sinta (s@mea.co.id)"
    );
    expect(summarizeProposal("delete", "Sinta (s@mea.co.id)", {})).toBe(
      "Hapus permanen Sinta (s@mea.co.id)"
    );
  });

  it("label snapshot memuat nama + email supaya riwayat tetap terbaca setelah user dihapus", () => {
    expect(memberLabel({ name: "Sinta", email: "s@mea.co.id" })).toBe("Sinta (s@mea.co.id)");
  });
});

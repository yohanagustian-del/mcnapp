import { describe, it, expect } from "vitest";
import {
  DERIVED_CHILDREN,
  MATERIAL_CHILDREN,
  MAX_BULK_DELETE,
  blockReason,
} from "../delete";
import { PERMISSIONS, hasPermission, ROLES, MANAGEMENT_ROLES, type Role } from "@/lib/rbac";

describe("klasifikasi anak creators (hapus kreator)", () => {
  it("tidak ada tabel+kolom yang masuk dua grup sekaligus", () => {
    const key = (c: { table: string; column: string }) => `${c.table}.${c.column}`;
    const material = new Set(MATERIAL_CHILDREN.map(key));
    const overlap = DERIVED_CHILDREN.map(key).filter((k) => material.has(k));
    expect(overlap).toEqual([]);
  });

  it("tiap entri punya tabel, kolom, dan label yang terisi", () => {
    for (const c of [...MATERIAL_CHILDREN, ...DERIVED_CHILDREN]) {
      expect(c.table).toMatch(/^[a-z_]+$/);
      expect(c.column).toMatch(/^[a-z_]+$/);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  /**
   * Snapshot FK yang menunjuk ke `creators` (information_schema, 32 entri).
   * Kalau ada tabel baru dengan FK ke creators, dia HARUS didaftarkan ke salah
   * satu grup — kalau tidak, delete gagal dengan error FK di produksi.
   */
  it("mencakup seluruh 32 FK yang menunjuk ke creators", () => {
    expect(MATERIAL_CHILDREN.length + DERIVED_CHILDREN.length).toBe(32);
  });

  it("data komersial/historis ada di grup material, bukan derived", () => {
    const material = new Set(MATERIAL_CHILDREN.map((c) => c.table));
    for (const t of [
      "creator_contracts", "creator_reports", "acquisitions", "referrals",
      "creator_users", "live_schedule_slots", "project_participants",
    ]) {
      expect(material.has(t)).toBe(true);
    }
  });

  it("data turunan upload mingguan ada di grup derived, bukan material", () => {
    const derived = new Set(DERIVED_CHILDREN.map((c) => c.table));
    for (const t of [
      "platform_metrics_raw", "transactions_all", "transactions_agency_link",
      "agency_links", "creator_link_status", "leakage_products", "metrics_monthly_agg",
    ]) {
      expect(derived.has(t)).toBe(true);
    }
  });

  /** referrals punya DUA FK (perekrut + kreator baru) — keduanya harus diperiksa. */
  it("memeriksa kedua kolom FK referrals", () => {
    const cols = MATERIAL_CHILDREN.filter((c) => c.table === "referrals").map((c) => c.column);
    expect(cols.sort()).toEqual(["new_creator_id", "referrer_creator_id"]);
  });
});

describe("blockReason", () => {
  it("null saat tidak ada data material (kreator aman dihapus)", () => {
    expect(blockReason({})).toBeNull();
    expect(blockReason({ "kontrak e-sign": 0, "report kreator (M2)": 0 })).toBeNull();
  });

  it("merinci label + jumlah untuk setiap dependensi yang ada", () => {
    const reason = blockReason({ "kontrak e-sign": 1, "report kreator (M2)": 3 });
    expect(reason).toBe("masih punya kontrak e-sign (1), report kreator (M2) (3)");
  });

  it("mengabaikan label yang nol dan hanya menyebut yang berisi", () => {
    expect(blockReason({ "kontrak e-sign": 0, "slot jadwal live (M13)": 2 })).toBe(
      "masih punya slot jadwal live (M13) (2)"
    );
  });
});

describe("RBAC creators.delete", () => {
  it("terdaftar di PERMISSIONS", () => {
    expect(PERMISSIONS["creators.delete"]).toBeDefined();
  });

  it("hanya management (director/head/spv) yang boleh hapus", () => {
    for (const role of MANAGEMENT_ROLES) {
      expect(hasPermission("creators.delete", role)).toBe(true);
    }
    const allowed = new Set<Role>(MANAGEMENT_ROLES);
    for (const role of ROLES) {
      if (!allowed.has(role)) expect(hasPermission("creators.delete", role)).toBe(false);
    }
  });

  /** CM boleh edit master data tapi TIDAK boleh menghapusnya (CLAUDE.md #2). */
  it("CM & akuisisi bisa edit tapi tidak bisa hapus", () => {
    for (const role of ["cpm", "cm_lead", "acquisition_spec", "creator_support"] as Role[]) {
      expect(hasPermission("creators.edit", role)).toBe(true);
      expect(hasPermission("creators.delete", role)).toBe(false);
    }
  });

  it("od_viewer ditolak (read-only absolut M11 §2A.3)", () => {
    expect(hasPermission("creators.delete", "od_viewer")).toBe(false);
  });
});

describe("batas bulk delete", () => {
  it("dibatasi supaya salah centang masif tidak langsung jalan", () => {
    expect(MAX_BULK_DELETE).toBeGreaterThan(0);
    expect(MAX_BULK_DELETE).toBeLessThanOrEqual(100);
  });
});

import { describe, expect, it } from "vitest";
import { validateNewPassword } from "@/lib/auth/password-reset";
import { creatorPortalAccess, generateTempPassword } from "../temp-password";
import { portalCredentialsMessage } from "../credentials";

describe("generateTempPassword", () => {
  it("format Mcn-XXXX-XXXX tanpa huruf/angka yang mirip (0/O, 1/I/L)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTempPassword()).toMatch(/^Mcn-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    }
  });
  it("lolos aturan password platform (min 8 karakter)", () => {
    const p = generateTempPassword();
    expect(validateNewPassword(p, p)).toBeNull();
  });
  it("unik per panggilan — tidak ada password default bersama", () => {
    const seen = new Set(Array.from({ length: 500 }, generateTempPassword));
    expect(seen.size).toBe(500);
  });
});

describe("creatorPortalAccess", () => {
  it("akun aktif → portal", () => {
    expect(creatorPortalAccess({ status: "active", must_change_password: false })).toBe("allow");
  });
  it("password sementara (undangan baru / Reset Password) → wajib ganti dulu", () => {
    expect(creatorPortalAccess({ status: "invited", must_change_password: true })).toBe("change_password");
    expect(creatorPortalAccess({ status: "active", must_change_password: true })).toBe("change_password");
  });
  it("ditangguhkan, belum ada akun, atau undangan lama yang belum aktif → ditolak", () => {
    expect(creatorPortalAccess({ status: "suspended", must_change_password: true })).toBe("reject");
    expect(creatorPortalAccess(null)).toBe("reject");
    expect(creatorPortalAccess({ status: "invited", must_change_password: false })).toBe("reject");
  });
});

describe("portalCredentialsMessage", () => {
  it("berisi link login, email, dan password sementara", () => {
    const msg = portalCredentialsMessage({
      creatorName: "Vika", loginUrl: "https://app.meamcn.com/login?portal=creator",
      email: "vika@mail.com", password: "Mcn-ABCD-EFGH",
    });
    expect(msg).toContain("Halo Vika!");
    expect(msg).toContain("Login: https://app.meamcn.com/login?portal=creator");
    expect(msg).toContain("Email: vika@mail.com");
    expect(msg).toContain("Password sementara: Mcn-ABCD-EFGH");
    expect(msg).toContain("diminta membuat password baru");
  });
});

import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  RESET_FORM_PATH,
  buildResetRedirectUrl,
  isValidEmail,
  normalizeEmail,
  safeNextPath,
  validateNewPassword,
} from "@/lib/auth/password-reset";

describe("normalizeEmail", () => {
  it("trims and lowercases so lookups match stored rows", () => {
    expect(normalizeEmail("  Yohan.Agustian@MEAgency.co.id ")).toBe(
      "yohan.agustian@meagency.co.id"
    );
  });

  it("returns an empty string for missing input", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts normal work addresses", () => {
    expect(isValidEmail("yohanagustian@meagency.co.id")).toBe(true);
    expect(isValidEmail("arsyrzmndh@gmail.com")).toBe(true);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "nama", "nama@", "@meagency.co.id", "a b@c.id", "nama@host", "nama@host.i"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("rejects addresses longer than the RFC limit", () => {
    expect(isValidEmail(`${"a".repeat(250)}@mea.co.id`)).toBe(false);
  });
});

describe("validateNewPassword", () => {
  it("passes a valid matching pair", () => {
    expect(validateNewPassword("rahasia123", "rahasia123")).toBeNull();
  });

  it("requires both fields", () => {
    expect(validateNewPassword("", "")).toMatch(/wajib diisi/);
    expect(validateNewPassword("rahasia123", "")).toMatch(/wajib diisi/);
  });

  it("enforces the minimum length", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateNewPassword(short, short)).toMatch(/minimal 8 karakter/);
  });

  it("rejects a mismatched confirmation", () => {
    expect(validateNewPassword("rahasia123", "rahasia124")).toMatch(/tidak cocok/);
  });
});

describe("buildResetRedirectUrl", () => {
  it("points at the callback and carries the form path", () => {
    expect(buildResetRedirectUrl("https://app.meagency.co.id")).toBe(
      "https://app.meagency.co.id/auth/confirm?next=%2Fauth%2Freset-password"
    );
  });

  it("tolerates a trailing slash in the configured origin", () => {
    expect(buildResetRedirectUrl("https://app.meagency.co.id/")).toBe(
      buildResetRedirectUrl("https://app.meagency.co.id")
    );
  });
});

describe("safeNextPath", () => {
  it("keeps same-site absolute paths", () => {
    expect(safeNextPath("/auth/reset-password")).toBe("/auth/reset-password");
    expect(safeNextPath("/account")).toBe("/account");
  });

  it("falls back for anything that could leave the site", () => {
    for (const bad of [null, "", "//evil.test/x", "https://evil.test", "/\\evil.test", "evil.test"]) {
      expect(safeNextPath(bad), String(bad)).toBe(RESET_FORM_PATH);
    }
  });
});

import { describe, it, expect } from "vitest";
import { NAV_ICON_PATHS, activeNavHref } from "@/lib/nav-ui";
import { NAV_ITEMS, NAV_GROUPS } from "@/lib/rbac";

describe("sidebar grouping", () => {
  it("gives every nav item a group that exists", () => {
    for (const item of NAV_ITEMS) {
      expect(NAV_GROUPS, `${item.href} punya grup tak dikenal`).toContain(item.group);
    }
  });

  it("leaves no group empty (an empty group would render as a stray heading)", () => {
    for (const group of NAV_GROUPS) {
      expect(NAV_ITEMS.some((i) => i.group === group), `grup "${group}" tidak punya menu`).toBe(true);
    }
  });
});

describe("NAV_ICON_PATHS", () => {
  // Saat sidebar diciutkan, ikon adalah SATU-SATUNYA penanda menu — href tanpa ikon
  // jatuh ke titik netral dan tidak bisa dibedakan dari menu lain.
  it("covers every nav item", () => {
    for (const item of NAV_ITEMS) {
      expect(NAV_ICON_PATHS[item.href], `${item.href} (${item.label}) belum punya ikon`).toBeTruthy();
    }
  });

  it("has no icon for an href that is not in the nav", () => {
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    for (const href of Object.keys(NAV_ICON_PATHS)) {
      expect(hrefs.has(href), `ikon ${href} tidak dipakai menu mana pun`).toBe(true);
    }
  });
});

describe("activeNavHref", () => {
  const hrefs = ["/dashboard", "/deals", "/deals/baru", "/deals/import", "/okr", "/okr/director"];

  it("matches an exact path", () => {
    expect(activeNavHref("/dashboard", hrefs)).toBe("/dashboard");
  });

  it("keeps the parent active on a detail route", () => {
    expect(activeNavHref("/deals/DEAL-123", hrefs)).toBe("/deals");
  });

  it("picks the longest match so parent and child are never both active", () => {
    expect(activeNavHref("/deals/baru", hrefs)).toBe("/deals/baru");
    expect(activeNavHref("/okr/director", hrefs)).toBe("/okr/director");
  });

  it("matches on segment boundaries only", () => {
    expect(activeNavHref("/dealsroom", hrefs)).toBeNull();
  });

  it("returns null for a path outside the nav", () => {
    expect(activeNavHref("/account", hrefs)).toBeNull();
  });
});

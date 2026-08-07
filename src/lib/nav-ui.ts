/**
 * Pure data + rules behind the portal sidebar (src/components/portal-sidebar.tsx).
 *
 * Kept out of the client component so both are unit-testable without React: which
 * menu counts as "active" and whether every menu has an icon are deterministic
 * rules, not rendering. The icon map especially — when the sidebar is collapsed the
 * icon is the ONLY thing identifying a menu, so a missing entry is a real defect,
 * and the test in __tests__/nav-ui.test.ts fails the build instead of shipping a
 * rail of identical dots.
 */

/**
 * SVG path per menu href (viewBox 24×24, stroke-based). Every NAV_ITEMS href must
 * have an entry here.
 */
export const NAV_ICON_PATHS: Record<string, string> = {
  "/dashboard": "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  "/okr": "M12 3v18M3 12h18M7.5 7.5l9 9M16.5 7.5l-9 9",
  "/creators": "M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 7.5a3 3 0 106 0 3 3 0 00-6 0M17 11l2 2 4-4",
  "/workspace/cm": "M3 7h18v12H3zM8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18",
  "/reports": "M8 3h8l4 4v14H4V3zM8 13h8M8 17h5M14 3v5h5",
  "/schedule": "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15h6",
  "/deals": "M3 8l9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5",
  "/deals/baru": "M12 5v14M5 12h14",
  "/deals/import": "M12 3v10m0 0l-4-4m4 4l4-4M4 17v3h16v-3",
  "/workspace/bizdev": "M3 20h18M6 20V9M11 20V4M16 20v-8M21 20v-5",
  "/matching":
    "M8 7a3 3 0 100-6 3 3 0 000 6zM8 23a3 3 0 100-6 3 3 0 000 6zM19 15a3 3 0 100-6 3 3 0 000 6zM11 5.5h3a2 2 0 012 2V9M11 18.5h3a2 2 0 002-2V15",
  "/products": "M20 7l-8-4-8 4v10l8 4 8-4zM4 7l8 4 8-4M12 11v10",
  "/projects": "M3 6h7l2 2h9v11H3zM3 10h18",
  "/workspace/ads": "M3 10v4h4l5 4V6L7 10zM16 8a5 5 0 010 8",
  "/workspace/external":
    "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18",
  "/workspace/acquisition": "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M11 8v6M8 11h6",
  "/ingest": "M12 16V4m0 0L8 8m4-4l4 4M4 17v3h16v-3",
  "/link-leakage": "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  "/tim": "M17 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 6.5a3 3 0 106 0 3 3 0 00-6 0M22 20v-2a4 4 0 00-3-3.87",
  "/okr/director":
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.32 1.77l.06.06a2 2 0 11-2.83 2.83l-.06-.06A1.6 1.6 0 0015 19.4a1.6 1.6 0 00-1 1.47V21a2 2 0 11-4 0v-.09A1.6 1.6 0 009 19.4a1.6 1.6 0 00-1.77.32l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.6 1.6 0 004.6 15a1.6 1.6 0 00-1.47-1H3a2 2 0 110-4h.09A1.6 1.6 0 004.6 9a1.6 1.6 0 00-.32-1.77l-.06-.06a2 2 0 112.83-2.83l.06.06A1.6 1.6 0 009 4.6a1.6 1.6 0 001-1.47V3a2 2 0 114 0v.09a1.6 1.6 0 001 1.47 1.6 1.6 0 001.77-.32l.06-.06a2 2 0 112.83 2.83l-.06.06A1.6 1.6 0 0019.4 9a1.6 1.6 0 001.47 1H21a2 2 0 110 4h-.09a1.6 1.6 0 00-1.47 1z",
  "/od": "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z",
  "/admin/retention":
    "M4 6c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3zM4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3",
};

/**
 * Menu aktif = href TERPANJANG yang cocok dengan pathname.
 *
 * Tanpa "terpanjang", membuka /deals/baru akan menyalakan /deals DAN /deals/baru
 * sekaligus (keduanya prefix yang cocok) — dua menu tampak aktif bersamaan.
 * Pencocokan hanya pada batas segmen: /deals TIDAK cocok dengan /dealsroom.
 */
export function activeNavHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}

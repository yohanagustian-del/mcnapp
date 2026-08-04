import type { Role } from "@/lib/rbac";

/** Mirrors team_group_t in the DB (0001_init_schema + 0010_rbac_foundation adds 'od'). */
export const TEAM_GROUPS = [
  "management", "acquisition", "cm", "bizdev", "external", "support", "finance", "od",
] as const;
export type TeamGroup = (typeof TEAM_GROUPS)[number];

/** Mirrors platform_segment_t. */
export const SEGMENTS = ["tiktok", "shopee", "celeb"] as const;

/**
 * Divisi setiap role — team_group selalu bisa diturunkan dari role, jadi kolom
 * team_group di sheet bersifat opsional (diisi otomatis kalau kosong). Deterministik,
 * bukan tebakan: satu role hanya milik satu divisi.
 *
 * Dipakai bersama oleh parser upload (tim/actions.ts) dan generator template
 * (tim/template.ts) supaya keterangan di template tidak pernah beda dengan
 * perilaku sistem yang sebenarnya.
 */
export const ROLE_TEAM_GROUP: Record<Role, TeamGroup> = {
  director: "management",
  head: "management",
  spv: "management",
  cm_lead: "cm",
  cpm: "cm",
  bizdev_lead: "bizdev",
  bizdev: "bizdev",
  campaign_ops: "bizdev",
  bd_admin: "bizdev",
  ads_support: "bizdev",
  acquisition_lead: "acquisition",
  acquisition_spec: "acquisition",
  campaign_external: "external",
  creator_support: "support",
  finance_lead: "finance",
  finance: "finance",
  od_viewer: "od",
};

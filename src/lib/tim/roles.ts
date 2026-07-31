/**
 * Daftar role + label & pemetaan divisi. Modul ini SENGAJA murni (tanpa import Supabase/Next)
 * supaya bisa dipakai komponen klien: `@/lib/rbac` memuat `next/headers` lewat createClient,
 * jadi mengimpor ROLES dari sana akan menarik kode server ke bundle browser.
 * `@/lib/rbac` me-re-export ROLES/Role dari sini demi kompatibilitas import lama.
 */
export const ROLES = [
  "director", "head", "spv",
  "cm_lead", "cpm",
  "bizdev_lead", "bizdev", "campaign_ops", "bd_admin",
  "acquisition_lead", "acquisition_spec",
  "campaign_external", "creator_support", "finance",
  // M10 §2.1: ads_support = sub-role of Campaign Ops (separate permissions, not top-level power).
  "ads_support",
  // M11 §2A: od_viewer = read-only oversight across all divisions; rejected on every mutation.
  "od_viewer",
] as const;
export type Role = (typeof ROLES)[number];

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
  finance: "finance",
  od_viewer: "od",
};

/**
 * Label jabatan untuk UI (Bahasa Indonesia). Satu sumber — dipakai sidebar,
 * tabel Tim, form ganti jabatan, dan panel usulan OD, supaya tidak ada role
 * yang tampil mentah (`ads_support`) di satu tempat dan rapi di tempat lain.
 */
export const ROLE_LABELS: Record<Role, string> = {
  director: "Director",
  head: "Head MCN",
  spv: "SPV MCN",
  cm_lead: "CM Lead",
  cpm: "CPM (Creator Manager)",
  bizdev_lead: "BizDev Lead",
  bizdev: "BizDev",
  campaign_ops: "Campaign Operations",
  bd_admin: "BD Administrator",
  ads_support: "Ads Support",
  acquisition_lead: "Acquisition Lead",
  acquisition_spec: "Acquisition Specialist",
  campaign_external: "Campaign External",
  creator_support: "Creator Support",
  finance: "Finance",
  od_viewer: "OD (Oversight, read-only)",
};

/** Label divisi untuk UI. */
export const TEAM_GROUP_LABELS: Record<TeamGroup, string> = {
  management: "Management",
  acquisition: "Akuisisi",
  cm: "Creator Management",
  bizdev: "BizDev",
  external: "External",
  support: "Support",
  finance: "Finance",
  od: "OD",
};

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

export const MANAGEMENT_ROLES: Role[] = ["director", "head", "spv"];
export const BIZDEV_ROLES: Role[] = ["bizdev_lead", "bizdev", "campaign_ops", "bd_admin"];
export const ACQUISITION_ROLES: Role[] = ["acquisition_lead", "acquisition_spec"];
export const CM_ROLES: Role[] = ["cm_lead", "cpm"];
// M10 §2.1: Campaign Ops division = campaign_ops (lead/assign) + ads_support (execute/input).
export const ADS_ROLES: Role[] = ["campaign_ops", "ads_support"];

/**
 * M9 external principal. `creator_user` is NOT a team_members role — it is a separate
 * Supabase Auth principal (table `creator_users`) carrying JWT claims role=creator_user +
 * creator_id. Internal RBAC below never grants it; the creator portal has its own guard.
 */
export const CREATOR_PRINCIPAL = "creator_user" as const;

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  team_group: string;
  platform_segment: string | null;
  active: boolean;
}

/** Nav items per PRD Module 01 §3.1 — sidebar filters by role (UI labels Bahasa Indonesia). */
export interface NavItem {
  href: string;
  label: string;
  roles: Role[] | "all";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dasbor", roles: "all" },
  { href: "/creators", label: "Kreator", roles: "all" },
  { href: "/deals", label: "Deal Brand", roles: [...MANAGEMENT_ROLES, ...BIZDEV_ROLES, "finance"] },
  { href: "/deals/baru", label: "Registrasi Deal", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"] },
  { href: "/deals/import", label: "Import Master Deal", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bd_admin"] },
  // Module 0.5: shared ingest (MCN + TAP) — process-on-ingest, drop-raw (matrix §2.8).
  { href: "/ingest", label: "Upload Data Platform Mingguan", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, "campaign_external"] },
  { href: "/link-leakage", label: "Link Leakage", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES, "campaign_external"] },
  { href: "/reports", label: "Report Kreator", roles: [...MANAGEMENT_ROLES, ...CM_ROLES] },
  { href: "/matching", label: "Matching (M5)", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, "bizdev_lead", "bizdev"] },
  // Product×Creator Matching: catalog TAP (master upload + derive dari TAP) + rekomendasi.
  { href: "/products", label: "Produk TAP", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES] },
  // Hidden from nav: postponed until production data is complete (user decision 2026-07-08).
  // Route & /predictor code left intact — only the menu entry is disabled.
  // { href: "/predictor", label: "Prediksi Deal (M6)", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"] },
  { href: "/projects", label: "Special Project (M7)", roles: [...MANAGEMENT_ROLES, "cm_lead", "bizdev_lead", "acquisition_lead", "campaign_ops", "finance"] },
  { href: "/workspace/cm", label: "CM Workspace", roles: [...MANAGEMENT_ROLES, ...CM_ROLES] },
  { href: "/workspace/bizdev", label: "BizDev Workspace", roles: [...MANAGEMENT_ROLES, ...BIZDEV_ROLES] },
  { href: "/workspace/acquisition", label: "Acquisition Workspace", roles: [...MANAGEMENT_ROLES, ...ACQUISITION_ROLES] },
  // M8 §2F: metrik approach external — External ✔, BizDev view, Management ✔.
  { href: "/workspace/external", label: "External Workspace", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev", "campaign_external"] },
  // M10: Campaign & Ads Support portal — Management + Campaign Ops (lead) + ads_support (execute).
  { href: "/workspace/ads", label: "Ads Support (M10)", roles: [...MANAGEMENT_ROLES, ...ADS_ROLES] },
  { href: "/tim", label: "Tim", roles: MANAGEMENT_ROLES },
  // M3 OKR: semua anggota bisa lihat KR sendiri; Director punya dashboard konfigurasi.
  { href: "/okr", label: "OKR & Kinerja", roles: "all" },
  { href: "/okr/director", label: "Config OKR (Director)", roles: ["director"] as Role[] },
  // M11: OD oversight portal — read-only cross-team (od_viewer + Director export).
  { href: "/od", label: "OD Oversight (M11)", roles: ["od_viewer", "director"] as Role[] },
  // M12: data retention & DB health dashboard — Director sets policy; Head/SPV + OD view.
  { href: "/admin/retention", label: "Retensi Data (M12)", roles: [...MANAGEMENT_ROLES, "od_viewer"] },
  // M13 Penjadwalan Live: CM + BizDev input slots; Creator Support verifies outside CM hours.
  { href: "/schedule", label: "Jadwal Live", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES, "creator_support"] },
];

/** Server-side write permissions per action (enforced in server actions + RLS, not just UI). */
export const PERMISSIONS: Record<string, Role[]> = {
  "team.bulk_upload": MANAGEMENT_ROLES,
  // Tambah kreator (manual satu baris lewat tombol "Tambah Kreator" di tab Kreator,
  // import Username+CM, dan upload master sheet lengkap). CM ikut punya izin ini:
  // CM-lah yang mendaftarkan kreator yang mereka pegang, dan mereka sudah boleh
  // mengedit seluruh kolom lewat creators.edit — menambah baris tidak lebih berisiko
  // daripada mengubahnya (CLAUDE.md #2: menambah data ≠ merugikan). Menghapus TETAP
  // management saja (creators.delete). Dicermin RLS creators_insert (0030).
  "creators.bulk_upload": [...MANAGEMENT_ROLES, ...CM_ROLES, ...ACQUISITION_ROLES],
  // Edit master data kreator per-row (username sering ganti, no HP, RC, level, dll).
  // Dimiliki CM (Creator Manager) + management + akuisisi + creator_support — sejajar
  // dengan RLS creators_update (0002). commission_share TETAP read-only (CLAUDE.md #3).
  "creators.edit": [...MANAGEMENT_ROLES, ...CM_ROLES, ...ACQUISITION_ROLES, "creator_support"],
  // Hapus master data kreator (permanen). SENGAJA management saja — bukan CM /
  // akuisisi: menghapus kreator berpotensi merugikan (CLAUDE.md #2), dan kreator
  // yang sudah punya kontrak/report/komisi ditolak di server (lib/creators/delete.ts)
  // dengan saran memakai status "nonaktif". Dicermin RLS creators_delete (0028).
  "creators.delete": MANAGEMENT_ROLES,
  "deals.register": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  "deals.import_legacy": [...MANAGEMENT_ROLES, "bizdev_lead", "bd_admin"],
  // Edit deal brand per-row: memperbaiki data master deal lama yang berantakan
  // (shop_id kosong, exp_date teks bebas, komisi "not found") lewat form tervalidasi
  // yang sama ketatnya dengan registrasi — CLAUDE.md #6. Dicermin RLS deals_update (0002),
  // jadi daftar role di sini sengaja sama dengan policy tersebut.
  "deals.edit": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev", "campaign_ops", "bd_admin", "finance"],
  // M4 §2.8: weekly CSV upload + engine run (Director/Head/SPV/CM Lead/CPM/Campaign Ops/External)
  "m4.upload": [...MANAGEMENT_ROLES, ...CM_ROLES, "campaign_ops", "campaign_external"],
  "m4.run": [...MANAGEMENT_ROLES, ...CM_ROLES, "campaign_ops"],
  // M4 read/export (leak rollup + per-product detail CSV) = /link-leakage nav roles.
  "m4.view": [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES, "campaign_external"],
  // Module 0.5 §2.8: shared weekly ingest (MCN + TAP) — Director/Head/SPV, CM Lead,
  // CPM (creator sendiri), Campaign External. BizDev tidak upload transaksi.
  "ingest.run": [...MANAGEMENT_ROLES, ...CM_ROLES, "campaign_external"],
  // Leak Artifact upload (Agency Leaked Generator output) — each CM uploads weekly
  // per creator they handle; Management sees all. Deterministic rollup store, 0 LLM.
  "leak.upload_artifact": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // M2 §2.5: generate = Director/Head/SPV/CM Lead/CPM; finalize/kirim = Head/SPV/CM Lead/CPM
  "reports.generate": [...MANAGEMENT_ROLES, ...CM_ROLES],
  "reports.finalize": ["head", "spv", ...CM_ROLES],
  // M5 §2.5: alat milik CPM (CM Lead untuk tim, management cross-team). BizDev tidak menjalankan.
  "m5.run": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // Product×Creator Matching: upload master product list TAP — CM & BizDev (yang pegang data TAP).
  "products.upload_master": [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES],
  // M6 §2.5: alat milik BizDev (+ management). CPM tidak menjalankan.
  "m6.run": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  // M7 §2.7: buat/edit project & kelola peserta/man power = management + lead terkait + PM (campaign_ops)
  "m7.manage": [...MANAGEMENT_ROLES, "cm_lead", "bizdev_lead", "acquisition_lead", "campaign_ops"],
  // M7: input metrik harian (GMV/ads/komisi) — pengelola project + finance (dimensi biaya/ads)
  "m7.metrics": [...MANAGEMENT_ROLES, "cm_lead", "bizdev_lead", "acquisition_lead", "campaign_ops", "finance"],
  // ===== M8 §2F RBAC matrix =====
  // Assign/re-assign creator ke CPM: Director/Head + CM Lead
  "m8.assign_creator": [...MANAGEMENT_ROLES, "cm_lead"],
  // Kelola req creator (sample/ads/HSL): management + CM (CPM untuk creator sendiri)
  "m8.creator_request": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // Req ads melewati cap → approval tambahan Director (§6.4)
  "m8.ads_approve": ["director"],
  // BizDev menerima & memproses req dari semua CM (§2B.1)
  "m8.request_process": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev", "bd_admin"],
  // Route req campaign ke CM: Director/Head + BizDev (§2F)
  "m8.route_campaign": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  // Konfirmasi creator join campaign: management + CM (CPM = creator sendiri)
  "m8.cm_confirm": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // Update acc brand (BizDev yang berhubungan dengan brand)
  "m8.brand_acc": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  // Handover req fix ke Campaign Ops (Module 1 §0.5)
  "m8.handover": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev", "campaign_ops"],
  // Kelola pipeline deal & report brand: management + BizDev
  "m8.pipeline": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  "m8.brand_report": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  // E-sign kontrak TC/Celeb: management + CM Lead + CPM (creator sendiri)
  "m8.esign": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // Tracking closing & referral: management + Akuisisi
  "m8.acquisition": [...MANAGEMENT_ROLES, ...ACQUISITION_ROLES],
  // Tandai komisi referral dibayar (dimensi pembayaran → + finance)
  "m8.referral_pay": [...MANAGEMENT_ROLES, "acquisition_lead", "finance"],
  // Log approach external creator
  "m8.external": [...MANAGEMENT_ROLES, "campaign_external"],
  // Tracker shop potensial CM→BizDev (lead manual, pelengkap lead otomatis M4)
  "m8.lead_manual": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // Scan growth mingguan + alert perf_drop (event, bukan approval)
  "m8.growth_scan": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // ===== M3 OKR =====
  // Set/edit target KR & reward: Director (owner) + Head (propose, tapi server action enforce Director only)
  "m3.set_target": ["director"] as Role[],
  "m3.set_reward": ["director"] as Role[],
  // Review gating event → putuskan gugur/tidak_gugur: Director only (PRD §2.3 LOCKED)
  "m3.gating_decision": ["director"] as Role[],
  // Trigger scoring mingguan: Director + Head/SPV
  "m3.score": [...MANAGEMENT_ROLES],
  // Ambil snapshot quartal: Director
  "m3.snapshot": ["director"] as Role[],
  // ===== M9 Creator Portal (§2.8) =====
  // Invite/suspend creator accounts: CM Lead/CPM (invite at binding) + Director/Head/SPV.
  "m9.invite": [...MANAGEMENT_ROLES, "cm_lead", "cpm"],
  // Reply to + close complaints: CPM (own creator) + CM Lead/Director. Body stays immutable (trigger).
  "m9.complaint_manage": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // Decide project join requests: management + relevant leads + PM (campaign_ops).
  "m9.project_join_decide": [...MANAGEMENT_ROLES, "cm_lead", "bizdev_lead", "acquisition_lead", "campaign_ops"],
  // ===== M10 Ads Support Portal (§2.6) =====
  // Buat brief ads: Director/Head/SPV + CM (creator-nya) + BizDev (deal). NOT ads_support.
  "m10.brief_create": [...MANAGEMENT_ROLES, ...CM_ROLES, "bizdev_lead", "bizdev"],
  // Klaim/assign & kerjakan brief: management + campaign_ops + ads_support.
  "m10.brief_execute": [...MANAGEMENT_ROLES, ...ADS_ROLES],
  // Input ads spend & metrik hasil (single-source ads_spend): management + campaign_ops + ads_support.
  "m10.result_input": [...MANAGEMENT_ROLES, ...ADS_ROLES],
  // Approve brief budget over ads_budget_cap: Director only (reuse M8 §2A.4/§6.4).
  "m10.budget_approve": ["director"] as Role[],
  // ===== M11 Governance (§2B/§2C) =====
  // Multi-Director account management (invite/suspend director & roles): Director.
  "m11.manage_accounts": ["director"] as Role[],
  // ===== M13 Penjadwalan Live Streaming (§ live-schedule) =====
  // View the weekly live-schedule calendar: management + CM + BizDev + Creator Support.
  "schedule.view": [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES, "creator_support"],
  // Create/edit/delete slots: management + CM + BizDev (lead+staff) + Creator Support.
  "schedule.edit": [...MANAGEMENT_ROLES, ...CM_ROLES, "bizdev_lead", "bizdev", "creator_support"],
  // Verify slots after the fact: CM verifies during work hours, CS outside them (+ management).
  "schedule.verify": [...MANAGEMENT_ROLES, ...CM_ROLES, "creator_support"],
  // Flag creators into the calendar (live_roster): management + CM lead/CPM.
  "schedule.roster": [...MANAGEMENT_ROLES, ...CM_ROLES],
  // ===== M12 Data Retention (§2.7) =====
  // Set retention policy/config: Director (Admin/DevOps folded into Director here).
  "m12.set_policy": ["director"] as Role[],
  // Run/trigger maintenance & purge jobs: Director.
  "m12.run_maintenance": ["director"] as Role[],
  // Manual permanent creator-data deletion (compliance): Director only + audit.
  "m12.purge_manual": ["director"] as Role[],
  // NOTE: od_viewer appears in NO write permission by design — every mutation is rejected
  // server-side (requirePermission) in addition to RLS. See __tests__/rbac.test.ts.
};

export function canAccessNav(item: NavItem, role: Role): boolean {
  return item.roles === "all" || item.roles.includes(role);
}

export function hasPermission(permission: keyof typeof PERMISSIONS, role: Role): boolean {
  return PERMISSIONS[permission]?.includes(role) ?? false;
}

/**
 * Loads the authenticated team member or redirects to /login.
 * Every portal page/layout and server action goes through this (server-enforced RBAC).
 */
export async function requireMember(): Promise<TeamMember> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, email, role, team_group, platform_segment, active")
    .eq("id", user.id)
    .single();

  if (!member || !member.active) {
    // Not an active team member — check if this auth user is actually a creator
    // hitting an internal page, so they bounce to their own portal instead of
    // seeing a "not registered" error. Lookup only runs in this failure path.
    const admin = createAdminClient();
    const { data: creatorUser } = await admin
      .from("creator_users")
      .select("id")
      .eq("auth_uid", user.id)
      .maybeSingle();

    if (creatorUser) redirect("/portal");
    redirect("/login?error=no_member");
  }
  return member as TeamMember;
}

/** Guard for server actions: authenticated member + permission check. Throws on violation. */
export async function requirePermission(permission: keyof typeof PERMISSIONS): Promise<TeamMember> {
  const member = await requireMember();
  if (!hasPermission(permission, member.role)) {
    throw new Error(`Akses ditolak: role ${member.role} tidak punya izin ${String(permission)}`);
  }
  return member;
}

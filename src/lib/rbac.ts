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

/**
 * Grup menu sidebar — item dikelompokkan per DIVISI/ROLE, bukan per modul.
 *
 * Menu penuh (management melihat semuanya) lebih dari 20 baris; tanpa grup, mencari
 * "Jadwal Live" berarti memindai seluruh daftar. Urutan array ini = urutan grup di
 * sidebar; grup yang seluruh itemnya tersaring RBAC tidak dirender sama sekali.
 */
export const NAV_GROUPS = [
  "Umum",
  "Creator Management",
  "BizDev & Deal",
  "Project & Campaign",
  "Akuisisi",
  "Data Platform",
  "Management & Admin",
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/** Nav items per PRD Module 01 §3.1 — sidebar filters by role (UI labels Bahasa Indonesia). */
export interface NavItem {
  href: string;
  label: string;
  roles: Role[] | "all";
  /** Grup sidebar tempat item ini tampil (wajib — item baru harus punya rumah). */
  group: NavGroup;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dasbor", roles: "all", group: "Umum" },
  // M3 OKR: semua anggota bisa lihat KR sendiri; Director punya dashboard konfigurasi.
  { href: "/okr", label: "OKR & Kinerja", roles: "all", group: "Umum" },

  { href: "/creators", label: "Kreator", roles: "all", group: "Creator Management" },
  { href: "/workspace/cm", label: "CM Workspace", roles: [...MANAGEMENT_ROLES, ...CM_ROLES], group: "Creator Management" },
  { href: "/reports", label: "Report Kreator", roles: [...MANAGEMENT_ROLES, ...CM_ROLES], group: "Creator Management" },
  // M13 Penjadwalan Live: CM + BizDev input slots; Creator Support verifies outside CM hours.
  { href: "/schedule", label: "Jadwal Live", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES, "creator_support"], group: "Creator Management" },
  // PX-M1: Product Exchange Creator Capability Registry — kapasitas match aktif
  // per (creator, level2, price_segment). BizDev (AM) butuh baca Coverage untuk
  // menjanjikan kuota admisi ke klien MEA Agency; hanya CM/CPM yang mengisi slot.
  { href: "/px/capability", label: "Kapasitas Kreator (PX)", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES], group: "Creator Management" },

  { href: "/deals", label: "Deal Brand", roles: [...MANAGEMENT_ROLES, ...BIZDEV_ROLES, "finance"], group: "BizDev & Deal" },
  { href: "/deals/baru", label: "Registrasi Deal", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"], group: "BizDev & Deal" },
  // Project BD: beberapa shop/brand digarap sebagai satu campaign. Pemirsanya sama
  // dengan Deal Brand — isinya memang pandangan lain atas data yang sama.
  { href: "/bd-projects", label: "Project BD", roles: [...MANAGEMENT_ROLES, ...BIZDEV_ROLES, "finance"], group: "BizDev & Deal" },
  { href: "/deals/import", label: "Import Master Deal", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bd_admin"], group: "BizDev & Deal" },
  { href: "/leads", label: "Brand Lead Bank", roles: [...MANAGEMENT_ROLES, ...BIZDEV_ROLES], group: "BizDev & Deal" },
  { href: "/workspace/bizdev", label: "BizDev Workspace", roles: [...MANAGEMENT_ROLES, ...BIZDEV_ROLES], group: "BizDev & Deal" },
  { href: "/matching", label: "Creator Product Match", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, "bizdev_lead", "bizdev"], group: "BizDev & Deal" },
  // Product×Creator Matching: catalog TAP (master upload + derive dari TAP) + rekomendasi.
  { href: "/products", label: "Produk TAP", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES], group: "BizDev & Deal" },
  // Un-hidden 2026-09-23: M6 diganti model pool (lib/m6/predictor.ts) —
  // lihat rencana PLAN_MCN_PRODUCT_MATCH_PREDICTOR_LEADBANK_PX.md §B.
  { href: "/predictor", label: "BD Value Predictor", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"], group: "BizDev & Deal" },

  { href: "/projects", label: "Special Project (M7)", roles: [...MANAGEMENT_ROLES, "cm_lead", "bizdev_lead", "acquisition_lead", "campaign_ops", "finance"], group: "Project & Campaign" },
  // M10: Campaign & Ads Support portal — Management + Campaign Ops (lead) + ads_support (execute).
  { href: "/workspace/ads", label: "Ads Support (M10)", roles: [...MANAGEMENT_ROLES, ...ADS_ROLES], group: "Project & Campaign" },
  // M8 §2F: metrik approach external — External ✔, BizDev view, Management ✔.
  // Acquisition Lead ditambahkan agar bisa memantau pipeline scouting untuk kandidat binding (§2D.2).
  { href: "/workspace/external", label: "External Workspace", roles: [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev", "campaign_external", "acquisition_lead"], group: "Project & Campaign" },

  { href: "/workspace/acquisition", label: "Acquisition Workspace", roles: [...MANAGEMENT_ROLES, ...ACQUISITION_ROLES], group: "Akuisisi" },

  // Module 0.5: shared ingest (MCN + TAP) — process-on-ingest, drop-raw (matrix §2.8).
  { href: "/ingest", label: "Upload Data Platform Mingguan", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, "campaign_external"], group: "Data Platform" },
  { href: "/link-leakage", label: "Link Leakage", roles: [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES, "campaign_external"], group: "Data Platform" },

  { href: "/tim", label: "Tim", roles: MANAGEMENT_ROLES, group: "Management & Admin" },
  { href: "/okr/director", label: "Config OKR (Director)", roles: ["director"] as Role[], group: "Management & Admin" },
  // M11: OD oversight portal — read-only cross-team (od_viewer + Director export).
  { href: "/od", label: "OD Oversight (M11)", roles: ["od_viewer", "director"] as Role[], group: "Management & Admin" },
  // M12: data retention & DB health dashboard — Director sets policy; Head/SPV + OD view.
  { href: "/admin/retention", label: "Retensi Data (M12)", roles: [...MANAGEMENT_ROLES, "od_viewer"], group: "Management & Admin" },
];

/** Server-side write permissions per action (enforced in server actions + RLS, not just UI). */
export const PERMISSIONS: Record<string, Role[]> = {
  "team.bulk_upload": MANAGEMENT_ROLES,
  // Nonaktifkan/aktifkan akun (mencabut akses login — RLS 0002 menggerbang
  // sesi lewat `active`). Management saja: menonaktifkan berpotensi merugikan
  // (CLAUDE.md #2), dan hard delete tidak dipakai — puluhan tabel (audit_logs,
  // creators.owner_cpm_id, project_manpower, dst) mereferensikan team_members
  // tanpa cascade, jadi riwayatnya harus tetap ada.
  "team.deactivate": MANAGEMENT_ROLES,
  // Tambah satu akun anggota tim lewat form (di luar bulk upload). Sengaja sama
  // persis dengan team.bulk_upload: menambah akun = memberi akses login baru ke
  // sistem internal, jadi dibatasi setara/di atas SPV (director/head/spv).
  "team.add_single": MANAGEMENT_ROLES,
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
  // CPM tidak boleh assign kreator ke dirinya sendiri (m8.assign_creator = Director/
  // Head/SPV/CM Lead), jadi jalurnya REQUEST: CM mengajukan, pemegang izin assign yang
  // memutuskan. Mengajukan request tidak mengubah data apa pun — aman untuk semua CM.
  "creators.request_cm": [...CM_ROLES],
  // Memutuskan (terima/tolak) request penugasan CM. Sengaja sama persis dengan
  // m8.assign_creator: yang boleh memutuskan = yang boleh assign.
  "creators.decide_cm_request": [...MANAGEMENT_ROLES, "cm_lead"],
  // Brand Lead Bank: semua BD lihat semua lead (permintaan user, bukan per-baris);
  // edit digerbang per-baris di server action (pembuat ATAU bizdev_lead/management),
  // bukan cuma daftar role di sini — pola sama K4 PX-M1.
  "leads.view": [...MANAGEMENT_ROLES, ...BIZDEV_ROLES],
  "leads.create": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  "leads.edit": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
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
  // Edit satu baris katalog produk (nama/shop/kategori/harga/rate komisi/aktif).
  // Sama dengan yang boleh mengunggah master: memperbaiki baris hasil upload kotor
  // tidak lebih berisiko daripada mengunggah ulang seluruh file.
  "products.edit": [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES],
  // Hapus baris katalog Produk TAP (termasuk hapus massal dari tabel). Sengaja
  // sama dengan products.edit — yang boleh memperbaiki katalog juga yang
  // membersihkannya — dan risikonya ditahan dengan cara lain: konfirmasi terpisah
  // di UI, batas jumlah per operasi, dan SELURUH isi baris yang dihapus ditulis ke
  // audit_logs sehingga masih bisa dikembalikan (CLAUDE.md #2).
  "products.delete": [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES],
  // Melihat kolom "Nama BD" (identitas peng-upload) di katalog Produk TAP. Tabelnya
  // sendiri terbuka untuk semua role yang bisa membuka /products; yang dibatasi hanya
  // identitas pemilik data: BizDev ke atas (sejajar deals.register). Role lain tetap
  // bisa menyaring per tim, tapi nama orangnya tidak dikirim ke browser mereka.
  "products.view_owner_name": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  // M6 §2.5: alat milik BizDev (+ management). CPM tidak menjalankan.
  "m6.run": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
  // M7 §2.7: buat/edit project & kelola peserta/man power = management + lead terkait + PM (campaign_ops)
  "m7.manage": [...MANAGEMENT_ROLES, "cm_lead", "bizdev_lead", "acquisition_lead", "campaign_ops"],
  // M7: input metrik harian (ads/komisi manual — GMV sendiri upload-only sejak v2 B5)
  // — pengelola project + finance (dimensi biaya/ads)
  "m7.metrics": [...MANAGEMENT_ROLES, "cm_lead", "bizdev_lead", "acquisition_lead", "campaign_ops", "finance"],
  // M7 v2 R13: superset kurasi peserta (approve/reject pendaftaran) — lebih luas dari
  // m7.manage (yang juga memberi hak ubah target/status project, jadi TIDAK dilonggarkan
  // untuk ini). Ditambahkan di Fase 0; dipakai mulai Fase 2 saat decideProjectJoinRequest
  // diperluas (BUILD_PLAN_M7_V2 §0.2).
  "m7.curate": [
    ...MANAGEMENT_ROLES, "cm_lead", "cpm", "bizdev_lead", "bizdev", "campaign_ops",
    "acquisition_lead", "acquisition_spec",
  ],
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
  // Buat & ubah Project BD (pengelompokan beberapa shop jadi satu campaign).
  // Sejajar dengan deals.register: yang menutup deal juga yang menyusun projectnya.
  // Menghapus project TIDAK menyentuh kartu produk mana pun — project cuma
  // pengelompokan — jadi izinnya sama, tanpa gerbang khusus management.
  "bd_project.manage": [...MANAGEMENT_ROLES, "bizdev_lead", "bizdev"],
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
  // ===== PX-M1 Creator Capability Registry (bridge.px_creator_capability) =====
  // Baca tab Registry & Coverage: management + CM (mengisi) + BizDev (AM, butuh
  // baca Coverage untuk menjanjikan kuota admisi ke klien MEA Agency).
  "px.capability.read": [...MANAGEMENT_ROLES, ...CM_ROLES, ...BIZDEV_ROLES],
  // Ubah slots_total: management + cm_lead (Lukman/Sr SPV MCN konfirmasi CM Lead
  // menilai lintas-tim dari data) + cpm (HANYA kreator sendiri — K4, ditegakkan
  // per-baris di server action, BUKAN lewat daftar role ini; lihat requireMember
  // + creators.owner_cpm_id check di src/app/(portal)/px/capability/actions.ts).
  "px.capability.write": [...MANAGEMENT_ROLES, "cm_lead", "cpm"],
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

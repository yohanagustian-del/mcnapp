import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectRequirements } from "@/lib/m7/requirements";
import { ProjectRequirementsPanel } from "@/components/project-requirements-panel";
import { latestTwoPeriods, type PeriodSummaryPoint } from "@/lib/m8/routing";
import {
  aggregateWeeklyByGroup,
  availableMonths,
  buildMonthlyGrowth,
  type MonthlyGrowth,
  type WeeklyGrowthInputRow,
} from "@/lib/m8/weekly-growth";
import {
  approveAdsRequest,
  createContract,
  createCreatorRequest,
  refreshGrowthAlerts,
  registerCmDeal,
  submitShopLead,
  transitionContract,
} from "./actions";
import { CompactScheduleList, type CompactSlotRow } from "../../schedule/compact-list";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import { ComplaintReplyForm, ComplaintStatusForm } from "./complaint-forms";
import { rupiah } from "@/lib/utils/format";
import { WeeklyGrowthTable, type WeeklyGrowthRow } from "./weekly-growth-table";
import { CmWeeklyGrowthTable, type CmWeeklyGrowthRow } from "./cm-weekly-growth-table";
import { CreatorGrowthPanel, type CreatorGrowthRow } from "./creator-growth-panel";
import { LeakTable, type LeakTableRow } from "./leak-table";
import { CampaignRequestsTable, type CampaignRequestRow } from "./campaign-requests-table";
import { CmProductMatchPanel } from "./cm-product-match-panel";

export const dynamic = "force-dynamic";

interface LeakStatusRow {
  creator_id: string;
  week: string;
  link_status: string | null;
  gmv_bocor: number | null;
  leak_ratio: number | null;
  gmv_tap: number | null;
  gmv_affiliate_total: number | null;
  source: string | null;
  computed_at: string | null;
}

interface LeakWeekSummaryRow {
  week: string;
  period_end: string;
  gmv_affiliate_total: number | null;
  gmv_tap: number | null;
  gmv_leak_potential: number | null;
  source_format: string;
  uploaded_by: string | null;
  created_at: string;
}

interface ComplaintRow {
  id: number;
  creator_id: string;
  category: string;
  severity: string;
  body: string;
  status: string;
  target_cpm_id: string | null;
  created_at: string;
  closed_at: string | null;
}

interface ComplaintReplyRow {
  complaint_id: number;
  author_role: string;
  body: string;
  created_at: string;
}

/** M9 komplain — status badge (UI Bahasa Indonesia). */
const COMPLAINT_STATUS_STYLES: Record<string, string> = {
  baru: "bg-red-100 text-red-700",
  "dalam-penyelesaian": "bg-amber-100 text-amber-800",
  selesai: "bg-green-100 text-green-800",
};
const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  baru: "Baru",
  "dalam-penyelesaian": "Dalam Penyelesaian",
  selesai: "Selesai",
};
const SEVERITY_STYLES: Record<string, string> = {
  rendah: "bg-slate-100 text-slate-600",
  sedang: "bg-amber-100 text-amber-800",
  tinggi: "bg-red-100 text-red-700",
};

/** Agency link effectiveness = gmv_tap / gmv_affiliate_total (fraction), null if either missing. */
function effectiveness(row: LeakStatusRow): number | null {
  const tap = row.gmv_tap;
  const total = row.gmv_affiliate_total;
  if (tap === null || total === null || Number(total) <= 0) return null;
  return Number(tap) / Number(total);
}

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700";
const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

export default async function CmWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ bulan?: string }>;
}) {
  const member = await requireMember();
  const isCpm = member.role === "cpm";
  const canAssign = hasPermission("m8.assign_creator", member.role);
  const canRequest = hasPermission("m8.creator_request", member.role);
  const canApproveAds = hasPermission("m8.ads_approve", member.role);
  const canEsign = hasPermission("m8.esign", member.role);
  const canViewSchedule = hasPermission("schedule.view", member.role);
  const canManageComplaints = hasPermission("m9.complaint_manage", member.role);

  const supabase = await createClient();

  // Scope: CPM lihat creator sendiri; CM Lead/management lintas (§2F).
  let creatorsQuery = supabase
    .from("creators")
    // creator_class + niche/top_niches ikut diambil: dipakai filter "Kelas" &
    // "Kategori" di tabel Pertumbuhan GMV Mingguan dan Creator & Growth Mingguan.
    // creators punya dua FK ke team_members (CM + Akuisitor) → embed CM harus
    // menyebut nama constraint-nya, kalau tidak PostgREST menolak sebagai ambigu.
    .select("id, name, username, level, segment, status, gmv, owner_cpm_id, ads_budget_cap, creator_class, niche, top_niches, team_members!creators_owner_cpm_id_fkey(name)")
    .order("gmv", { ascending: false })
    .limit(100);
  if (isCpm) creatorsQuery = creatorsQuery.eq("owner_cpm_id", member.id);
  const { data: creatorRows } = await creatorsQuery;
  // team_members(name) = CM pemilik (owner_cpm_id) — dipakai filter CM di tabel client.
  const creators = (creatorRows ?? []).map((c) => ({
    ...c,
    cmName: (c.team_members as { name?: string } | null)?.name ?? null,
    // Kategori tampil = niche utama; kalau kolom niche kosong, pakai top_niches[0]
    // (diisi otomatis dari upload mingguan). null = belum ada kategori.
    kategori:
      (c.niche as string | null) ||
      ((c.top_niches as string[] | null) ?? [])[0] ||
      null,
  }));
  const creatorIds = creators.map((c) => c.id);

  // ===== M13 Jadwal Live — compact read-only preview (scope: sama seperti creators di atas) =====
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  type RosterCreator = {
    id: string;
    name: string;
    username: string | null;
    owner_cpm_id: string | null;
    live_roster: boolean;
    team_members: { name?: string } | null;
  };
  let rosterQuery = supabase
    .from("creators")
    .select("id, name, username, owner_cpm_id, live_roster, team_members!creators_owner_cpm_id_fkey(name)")
    .eq("live_roster", true)
    .limit(300);
  if (isCpm) rosterQuery = rosterQuery.eq("owner_cpm_id", member.id);
  const { data: rosterCreatorRows } = canViewSchedule
    ? await rosterQuery
    : { data: [] as RosterCreator[] };
  const rosterCreators = (rosterCreatorRows ?? []) as unknown as RosterCreator[];
  const rosterIds = rosterCreators.map((c) => c.id);
  const rosterById = new Map(rosterCreators.map((c) => [c.id, c]));
  const { data: todayTomorrowSlots } = rosterIds.length
    ? await supabase
        .from("live_schedule_slots")
        .select("*")
        .in("creator_id", rosterIds)
        .in("schedule_date", [todayIso, tomorrowIso])
        .order("schedule_date", { ascending: true })
    : { data: [] as LiveScheduleSlot[] };
  const scheduleRows: CompactSlotRow[] = ((todayTomorrowSlots ?? []) as LiveScheduleSlot[]).map((s) => {
    const rc = rosterById.get(s.creator_id);
    return {
      slot: s,
      creatorName: rc?.name ?? s.creator_id,
      creatorUsername: rc?.username ?? null,
      ownerCpmId: rc?.owner_cpm_id ?? null,
      cmName: rc?.team_members?.name ?? null,
    };
  });
  const creatorsWithTomorrowSlot = new Set(
    ((todayTomorrowSlots ?? []) as LiveScheduleSlot[])
      .filter((s) => s.schedule_date === tomorrowIso)
      .map((s) => s.creator_id)
  );
  const missingTomorrow = rosterCreators
    .filter((c) => !creatorsWithTomorrowSlot.has(c.id))
    .map((c) => c.name);

  // Growth mingguan per creator (§2A.2) — Module 0.5 Fase 2: creator_period_summary
  // adalah source of truth (1 baris per creator per periode per batch), bukan
  // platform_metrics_raw per-hari (bug lama: "1 hari" tampil sebagai "1 minggu").
  const { data: periodRows } = creatorIds.length
    ? await supabase
        .from("creator_period_summary")
        .select("creator_id, period_start, period_end, upload_batch, affiliate_gmv, created_at")
        .in("creator_id", creatorIds)
        .order("period_start", { ascending: false })
        .limit(1000)
    : { data: [] as { creator_id: string; period_start: string; period_end: string; upload_batch: string; affiliate_gmv: number | null; created_at: string }[] };
  const growth = new Map<string, { current: number; previous: number | null; periodStart: string; periodEnd: string }>();
  {
    const byCreator = new Map<string, PeriodSummaryPoint[]>();
    for (const r of periodRows ?? []) {
      const list = byCreator.get(r.creator_id) ?? [];
      list.push({
        periodStart: r.period_start,
        periodEnd: r.period_end,
        uploadBatch: r.upload_batch,
        affiliateGmv: Number(r.affiliate_gmv ?? 0),
        createdAt: r.created_at,
      });
      byCreator.set(r.creator_id, list);
    }
    for (const [creatorId, rows] of byCreator) {
      const point = latestTwoPeriods(rows);
      if (point) {
        growth.set(creatorId, {
          current: point.current, previous: point.previous,
          periodStart: point.periodStart, periodEnd: point.periodEnd,
        });
      }
    }
  }

  // ===== Pertumbuhan GMV Mingguan (W1-W5) — pemilih bulan =====
  // availableMonths dari periodRows di atas (limit 1000, cukup untuk daftar bulan).
  const monthsFromLimitedRows = availableMonths(
    (periodRows ?? []).map((r): WeeklyGrowthInputRow => ({
      creatorId: r.creator_id,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      affiliateGmv: Number(r.affiliate_gmv ?? 0),
      createdAt: r.created_at,
    }))
  );
  const { bulan: bulanParam } = await searchParams;
  const selectedMonth = bulanParam?.trim() || monthsFromLimitedRows[0] || null;

  // Query kedua ter-scope bulan (jangan andalkan limit 1000 global — bulan lama
  // bisa terpotong kalau creator/minggu banyak).
  let monthlyRows: WeeklyGrowthInputRow[] = [];
  if (selectedMonth && creatorIds.length) {
    const monthStart = `${selectedMonth}-01`;
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
    const { data: monthRows } = await supabase
      .from("creator_period_summary")
      .select("creator_id, period_start, period_end, affiliate_gmv, created_at")
      .in("creator_id", creatorIds)
      .gte("period_start", monthStart)
      .lte("period_start", monthEnd)
      .limit(2000);
    monthlyRows = (monthRows ?? []).map((r) => ({
      creatorId: r.creator_id,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      affiliateGmv: Number(r.affiliate_gmv ?? 0),
      createdAt: r.created_at,
    }));
  }
  const monthlyGrowth = selectedMonth
    ? buildMonthlyGrowth(monthlyRows, selectedMonth)
    : new Map<string, MonthlyGrowth>();
  // Hanya creator yang punya minimal satu minggu terisi bulan ini — creator tanpa upload
  // adalah noise, bukan "Rp0". Baris TOTAL dihitung di klien dari baris terfilter.
  const weeklyGrowthRows: WeeklyGrowthRow[] = creators
    .filter((c) => monthlyGrowth.has(c.id))
    .map((c) => {
      const g = monthlyGrowth.get(c.id)!;
      return {
        creatorId: c.id,
        name: c.name,
        username: c.username ?? null,
        ownerCpmId: c.owner_cpm_id ?? null,
        cmName: c.cmName,
        creatorClass: c.creator_class ?? null,
        kategori: c.kategori,
        weeks: g.weeks,
        deltas: g.deltas,
        monthTotal: g.monthTotal,
        monthGrowthPct: g.monthGrowthPct,
      };
    });

  // Rollup baris di atas ke level CM (tabel "Growth Mingguan per CM"). Diagregasi
  // di server dari weeklyGrowthRows yang SAMA — bukan query/perhitungan kedua,
  // jadi angka per-CM selalu konsisten dengan tabel per-kreator (CLAUDE.md #4).
  const cmNameByOwnerId = new Map<string, string>();
  for (const r of weeklyGrowthRows) {
    if (r.ownerCpmId && r.cmName) cmNameByOwnerId.set(r.ownerCpmId, r.cmName);
  }
  const cmWeeklyGrowthRows: CmWeeklyGrowthRow[] = aggregateWeeklyByGroup(
    weeklyGrowthRows,
    (r) => r.ownerCpmId ?? "",
    (r) => r.weeks
  ).map((g) => ({
    cpmId: g.key || null,
    // owner_cpm_id terisi tapi tidak ada di team_members = anggota nonaktif/terhapus;
    // ditandai eksplisit daripada ditampilkan sebagai uuid mentah.
    cmName: g.key ? cmNameByOwnerId.get(g.key) ?? "CM tidak dikenal" : "Tanpa CM",
    creatorCount: g.members,
    weeks: g.weeks,
    deltas: g.deltas,
    monthTotal: g.monthTotal,
    monthGrowthPct: g.monthGrowthPct,
  }));

  let campaignReqQuery = supabase
    .from("campaign_requests")
    .select("id, deal_id, creator_id, owner_cpm_id, route_type, level2_category, request_text, cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handed_over_at, notes, created_at, brand_deals(brand_name), creators(name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (isCpm) campaignReqQuery = campaignReqQuery.eq("owner_cpm_id", member.id);

  let creatorReqQuery = supabase
    .from("creator_requests")
    .select("id, creator_id, type, target_brand, status, amount, approval_status, notes, creators(name, owner_cpm_id)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (isCpm && creatorIds.length) creatorReqQuery = creatorReqQuery.in("creator_id", creatorIds);

  const [{ data: campaignReqs }, { data: creatorReqs }, { data: alerts }, { data: reports }, { data: contracts }, { data: cpms }, { data: leakWeekSummary }] =
    await Promise.all([
      campaignReqQuery,
      creatorReqQuery,
      supabase
        .from("platform_alerts")
        .select("id, entity_id, message, week, created_at")
        .eq("alert_type", "perf_drop")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(50),
      creatorIds.length
        ? supabase
            .from("creator_reports")
            .select("id, creator_id, period_type, period_start, status, token_used, creators(name)")
            .in("creator_id", creatorIds)
            .order("generated_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] as never[] }),
      creatorIds.length
        ? supabase
            .from("creator_contracts")
            .select("id, creator_id, segment, esign_status, provider, sent_at, signed_at, expires_at, creators(name)")
            .in("creator_id", creatorIds)
            .order("id", { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] as never[] }),
      canAssign
        ? supabase.from("team_members").select("id, name, role").in("role", ["cpm", "cm_lead"]).eq("active", true)
        : Promise.resolve({ data: [] as never[] }),
      // Ringkasan CM-level minggu terbaru dari artifak Agency Leaked Generator (format v1/v2).
      supabase
        .from("leak_week_summary")
        .select("week, period_end, gmv_affiliate_total, gmv_tap, gmv_leak_potential, source_format, uploaded_by, created_at")
        .order("week", { ascending: false })
        .limit(1),
    ]);

  const scopedAlerts = (alerts ?? []).filter((a) => !isCpm || creatorIds.includes(a.entity_id ?? ""));
  const name = (rel: unknown) => (rel as { name?: string } | null)?.name ?? "—";

  // Opsi dropdown "pilih kreator" pada req broadcast (dipakai komponen klien).
  const creatorPickOptions = creators.map((c) => ({ id: c.id, name: c.name }));

  const campaignRequestRows: CampaignRequestRow[] = (campaignReqs ?? []).map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    brandName: (r.brand_deals as { brand_name?: string } | null)?.brand_name ?? null,
    creatorId: r.creator_id,
    creatorName: (r.creators as { name?: string } | null)?.name ?? null,
    routeType: r.route_type,
    level2Category: r.level2_category,
    requestText: r.request_text,
    cmConfirmStatus: r.cm_confirm_status,
    needsBrandAcc: Boolean(r.needs_brand_acc),
    brandAccStatus: r.brand_acc_status,
    finalStatus: r.final_status,
    handedOverAt: r.handed_over_at,
  }));

  // Baris tabel "Creator & Growth Mingguan" — delta dihitung di sini (server), komponen
  // klien hanya search/filter/paginasi (CLAUDE.md #4: tidak ada perhitungan ulang di UI).
  const creatorGrowthRows: CreatorGrowthRow[] = creators.map((c) => {
    const g = growth.get(c.id);
    return {
      creatorId: c.id,
      name: c.name,
      username: c.username ?? null,
      ownerCpmId: c.owner_cpm_id ?? null,
      cmName: c.cmName,
      creatorClass: c.creator_class ?? null,
      kategori: c.kategori,
      level: c.level,
      segment: c.segment,
      current: g ? g.current : null,
      periodStart: g ? g.periodStart : null,
      periodEnd: g ? g.periodEnd : null,
      delta: g && g.previous ? (g.current - g.previous) / g.previous : null,
    };
  });

  // M7 creator requirements surfaced so CM knows who to recruit/bind.
  const projectReqs = await getProjectRequirements(supabase);

  // Deal hasil sourcing CM langsung (tanpa BizDev) — QA feedback.
  let cmDealsQuery = supabase
    .from("brand_deals")
    .select("id, brand_name, shop_id, niche, exp_date, komisi_kreator_raw, campaign_type, status, notes, sourced_by, created_at")
    .eq("sourced_by_role", "cm")
    .order("created_at", { ascending: false })
    .limit(30);
  if (isCpm) cmDealsQuery = cmDealsQuery.eq("sourced_by", member.id);
  const { data: cmDeals } = await cmDealsQuery;

  // Link leakage rollup per creator (creator_link_status) — latest week per creator
  // in scope. Management/CM Lead lihat semua creator yang diambil di atas; CPM sudah
  // ter-scope ke owner_cpm_id via creatorIds. Read-only (CLAUDE.md #3 — engine/artifak
  // yang menulis, tidak ada edit manual).
  const { data: leakStatusRows } = creatorIds.length
    ? await supabase
        .from("creator_link_status")
        .select("creator_id, week, link_status, gmv_bocor, leak_ratio, gmv_tap, gmv_affiliate_total, source, computed_at")
        .in("creator_id", creatorIds)
        .order("week", { ascending: false })
        .limit(2000)
    : { data: [] as LeakStatusRow[] };
  // Keep only the newest week per creator (rows already sorted desc by week).
  const latestLeakByCreator = new Map<string, LeakStatusRow>();
  for (const r of (leakStatusRows ?? []) as LeakStatusRow[]) {
    if (!latestLeakByCreator.has(r.creator_id)) latestLeakByCreator.set(r.creator_id, r);
  }
  const creatorById = new Map(creators.map((c) => [c.id, c]));
  const leakRows: LeakTableRow[] = [...latestLeakByCreator.values()]
    .sort((a, b) => Number(b.gmv_bocor ?? 0) - Number(a.gmv_bocor ?? 0))
    .map((r) => {
      const c = creatorById.get(r.creator_id);
      return {
        creatorId: r.creator_id,
        creatorName: c?.name ?? "—",
        username: c?.username ?? null,
        ownerCpmId: c?.owner_cpm_id ?? null,
        cmName: c?.cmName ?? null,
        week: r.week,
        linkStatus: r.link_status,
        gmvBocor: r.gmv_bocor,
        leakRatio: r.leak_ratio,
        effectiveness: effectiveness(r),
        source: r.source,
      };
    });
  const latestLeakWeek: LeakWeekSummaryRow | null = (leakWeekSummary?.[0] as LeakWeekSummaryRow) ?? null;

  // ===== M9 Komplain Kreator — surfaced ke CM Workspace (sebelumnya tak tampil di mana pun) =====
  // Scope: CPM hanya lihat komplain yang ditargetkan ke dirinya (target_cpm_id); CM Lead/
  // management lintas (§2F, sama seperti section lain di halaman ini).
  // RLS on creator_complaints/complaint_replies only grants creator self-read — internal
  // reads must go through the service-role client; scoping enforced in code above/below.
  const complaintsAdmin = createAdminClient();
  let complaintsQuery = complaintsAdmin
    .from("creator_complaints")
    .select("id, creator_id, category, severity, body, status, target_cpm_id, created_at, closed_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (isCpm) complaintsQuery = complaintsQuery.eq("target_cpm_id", member.id);
  const { data: complaintRows } = await complaintsQuery;
  const complaints = (complaintRows ?? []) as ComplaintRow[];

  const complaintCreatorIds = [...new Set(complaints.map((c) => c.creator_id))];
  const { data: complaintCreators } = complaintCreatorIds.length
    ? await supabase.from("creators").select("id, name").in("id", complaintCreatorIds)
    : { data: [] as { id: string; name: string }[] };
  const complaintCreatorNameById = new Map((complaintCreators ?? []).map((c) => [c.id, c.name]));

  const complaintIds = complaints.map((c) => c.id);
  const { data: complaintReplyRows } = complaintIds.length
    ? await complaintsAdmin
        .from("complaint_replies")
        .select("complaint_id, author_role, body, created_at")
        .in("complaint_id", complaintIds)
        .order("created_at", { ascending: true })
    : { data: [] as ComplaintReplyRow[] };
  const repliesByComplaint = new Map<number, ComplaintReplyRow[]>();
  for (const r of (complaintReplyRows ?? []) as ComplaintReplyRow[]) {
    const list = repliesByComplaint.get(r.complaint_id) ?? [];
    list.push(r);
    repliesByComplaint.set(r.complaint_id, list);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">CM Workspace (M8)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Inkubasi & growth creator, req sample/ads/HSL, konfirmasi campaign dari BizDev, kontrak
          TC/Celeb. Semua deterministik — 0 token AI (surface report M2, tidak dihitung ulang).
        </p>
      </div>

      <ProjectRequirementsPanel requirements={projectReqs} focus="creator" />

      {/* ===== M13 Jadwal Live — preview read-only hari ini + besok ===== */}
      {canViewSchedule && (
        <>
          <CompactScheduleList
            title="Jadwal Live (hari ini & besok)"
            rows={scheduleRows}
            todayIso={todayIso}
            emptyLabel="Belum ada jadwal live untuk hari ini/besok di scope Anda."
            filterable
            showAdsNote
          />
          {missingTomorrow.length > 0 && (
            <p className="-mt-4 rounded-md bg-red-50 p-2 text-xs text-red-700">
              Besok belum ada jadwal: {missingTomorrow.join(", ")}
            </p>
          )}
        </>
      )}

      {/* ===== Pertumbuhan GMV Mingguan (W1-W5) — pemilih bulan ===== */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Pertumbuhan GMV Mingguan</h2>
          <form method="get" className="flex items-center gap-2 text-sm">
            <label htmlFor="bulan" className="text-xs text-slate-500">Bulan</label>
            <select
              id="bulan"
              name="bulan"
              defaultValue={selectedMonth ?? ""}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {monthsFromLimitedRows.length === 0 && selectedMonth && (
                <option value={selectedMonth}>{selectedMonth}</option>
              )}
              {monthsFromLimitedRows.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button type="submit" className={`${btnSmall} bg-slate-900 text-white`}>Tampilkan</button>
          </form>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          GMV affiliate per minggu (W1-W5) dari creator_period_summary. Panah dibanding minggu
          terisi sebelumnya. Minggu tanpa upload: “—”. Bisa difilter per CM, kelas kreator, dan
          kategori; klik judul kolom untuk mengurutkan naik/turun. 0 token AI (murni agregasi
          deterministik).
        </p>
        {!selectedMonth ? (
          <p className="mt-4 rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Belum ada data GMV mingguan untuk creator di scope ini — upload via /ingest.
          </p>
        ) : (
          <WeeklyGrowthTable rows={weeklyGrowthRows} />
        )}
      </section>

      {/* ===== §2A.2 Growth + alert performa ===== */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Creator & Growth Mingguan</h2>
          <form action={refreshGrowthAlerts}>
            <button type="submit" className={btn}>Scan Alert Performa (&gt;{""}ambang m8.perf_drop)</button>
          </form>
        </div>
        <CreatorGrowthPanel
          rows={creatorGrowthRows}
          alerts={scopedAlerts.map((a) => ({ id: a.id, message: a.message }))}
          cpms={(cpms ?? []).map((m) => ({ id: m.id, name: m.name }))}
          canAssign={canAssign}
        />
      </section>

      {/* ===== Rollup growth mingguan ke level CM ===== */}
      <section>
        <h2 className="text-lg font-medium">
          Growth Mingguan per CM{selectedMonth ? ` — ${selectedMonth}` : ""}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Tabel yang sama seperti Pertumbuhan GMV Mingguan, tapi dijumlahkan per CM: W1-W5 =
          total GMV seluruh kreator yang di-handle CM itu, Growth = minggu terisi terakhir vs
          minggu terisi pertama. Mengikuti bulan yang dipilih di atas. Murni agregasi
          deterministik — 0 token AI.
        </p>
        {!selectedMonth ? (
          <p className="mt-4 rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Belum ada data GMV mingguan untuk creator di scope ini — upload via /ingest.
          </p>
        ) : (
          <CmWeeklyGrowthTable rows={cmWeeklyGrowthRows} />
        )}
      </section>

      {/* ===== Produk Cocok per Kreator — Creator Product Match (satu engine, CLAUDE.md #4) ===== */}
      <section>
        <h2 className="text-lg font-medium">Produk Cocok per Kreator</h2>
        <p className="mt-1 text-xs text-slate-500">
          Pilih kreator (scope Anda) untuk melihat produk Deal TAP & PX Exchange yang cocok dengan
          kategori & segmen harga historisnya — engine yang sama dengan Creator Product Match &
          halaman detail kreator. Rule-based, 0 token AI.
        </p>
        <div className="mt-4">
          <CmProductMatchPanel creators={creators.map((c) => ({ id: c.id, name: c.name }))} />
        </div>
      </section>

      {/* ===== Link Leakage Kreator (per minggu) — rollup dari engine M4 / artifak ===== */}
      <section>
        <h2 className="text-lg font-medium">Link Leakage Kreator (per minggu)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Status link agency per kreator (minggu terbaru). Read-only — dihitung platform dari file
          MCN+TAP mingguan (upload di /ingest atau /link-leakage); baris lama bisa berasal dari
          artifak/engine. Tidak ada edit manual (CLAUDE.md #3). Klik header kolom untuk mengurutkan
          (naik/turun); tombol <strong>Detail</strong> mengunduh CSV produk bocor kreator itu pada
          minggu yang tampil.
        </p>
        {latestLeakWeek && (
          <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Total minggu {latestLeakWeek.week}: Affiliate {rupiah(latestLeakWeek.gmv_affiliate_total)} · TAP{" "}
            {rupiah(latestLeakWeek.gmv_tap)} · Potensi bocor {rupiah(latestLeakWeek.gmv_leak_potential)}
          </p>
        )}
        <LeakTable rows={leakRows} />
      </section>

      {/* ===== M9 Komplain Kreator ===== */}
      <section>
        <h2 className="text-lg font-medium">Komplain Kreator</h2>
        <p className="mt-1 text-xs text-slate-500">
          Komplain yang diajukan kreator dari portal (/portal/complaints). Scope: CPM lihat
          komplain yang ditargetkan ke dirinya; CM Lead/management lihat semua. Isi komplain
          immutable — hanya status yang bisa diubah (CLAUDE.md §2, §9.4 trigger SQL).
        </p>
        <div className="mt-3 space-y-3">
          {complaints.map((c) => {
            const replies = repliesByComplaint.get(c.id) ?? [];
            return (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">
                      {complaintCreatorNameById.get(c.creator_id) ?? "—"}
                    </span>{" "}
                    <span className="text-xs text-slate-400">{c.creator_id}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {c.category.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[c.severity] ?? ""}`}>
                      {c.severity}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COMPLAINT_STATUS_STYLES[c.status] ?? ""}`}>
                      {COMPLAINT_STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-700">{c.body}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Diajukan {new Date(c.created_at).toLocaleString("id-ID")}
                  {c.closed_at ? ` · ditutup ${new Date(c.closed_at).toLocaleString("id-ID")}` : ""}
                </p>

                {replies.length > 0 && (
                  <div className="mt-2 space-y-1 rounded-md bg-slate-50 p-2">
                    <p className="text-xs font-medium text-slate-500">
                      {replies.length} balasan · terbaru:
                    </p>
                    <p className="text-xs text-slate-600">
                      <span className="font-medium">{replies[replies.length - 1].author_role}:</span>{" "}
                      {replies[replies.length - 1].body}
                    </p>
                  </div>
                )}

                {canManageComplaints && (
                  <>
                    <ComplaintReplyForm complaintId={c.id} />
                    <ComplaintStatusForm complaintId={c.id} status={c.status} />
                  </>
                )}
              </div>
            );
          })}
          {complaints.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
              Belum ada komplain dari kreator di scope Anda.
            </p>
          )}
        </div>
      </section>

      {/* ===== §2A.6 Campaign dari BizDev (routing §2E) ===== */}
      <section>
        <h2 className="text-lg font-medium">Campaign dari BizDev — perlu konfirmasi</h2>
        <p className="mt-1 text-xs text-slate-500">
          Req kreator (langsung ke Anda) + req kategori/broadcast (BizDev tidak sebut kreator —
          Anda pilih kreator sendiri lalu konfirmasi). §2E.1.
        </p>
        <CampaignRequestsTable rows={campaignRequestRows} creators={creatorPickOptions} />
      </section>

      {/* ===== §2A.4 Req creator (sample/ads/HSL) + §2A.5 shop potensial ===== */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-medium">Req Creator (sample / ads / HSL)</h2>
          {canRequest && (
            <form action={createCreatorRequest} className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
              <select name="creator_id" required className={input}>
                <option value="">— creator —</option>
                {creators.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
              </select>
              <select name="type" required className={input}>
                <option value="sample">Sample produk</option>
                <option value="ads">Ads support (cek ads cap)</option>
                <option value="hsl">Harga Special Live (per sesi)</option>
              </select>
              <input name="target_brand" placeholder="Brand tujuan" className={input} />
              <input name="amount" placeholder="Nominal (Rp, untuk ads)" className={input} />
              <input name="notes" placeholder="Catatan" className={`${input} sm:col-span-2`} />
              <button type="submit" className={`${btn} sm:col-span-2`}>Ajukan Req</button>
            </form>
          )}
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Creator</th><th className="px-3 py-2">Jenis</th>
                  <th className="px-3 py-2">Brand</th><th className="px-3 py-2">Nominal</th>
                  <th className="px-3 py-2">Status</th><th className="px-3 py-2">Approval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(creatorReqs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{name(r.creators)}</td>
                    <td className="px-3 py-2 uppercase">{r.type}</td>
                    <td className="px-3 py-2">{r.target_brand ?? "—"}</td>
                    <td className="px-3 py-2">{rupiah(r.amount)}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">
                      {r.approval_status === "menunggu" && canApproveAds ? (
                        <div className="flex gap-1">
                          {(["approved", "ditolak"] as const).map((d) => (
                            <form key={d} action={approveAdsRequest}>
                              <input type="hidden" name="req_id" value={r.id} />
                              <input type="hidden" name="decision" value={d} />
                              <button type="submit" className={`${btnSmall} ${d === "approved" ? "bg-green-600 text-white" : "bg-red-100 text-red-700"}`}>{d}</button>
                            </form>
                          ))}
                        </div>
                      ) : r.approval_status === "menunggu" ? "menunggu Director" : r.approval_status}
                    </td>
                  </tr>
                ))}
                {(creatorReqs ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">Belum ada req.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-medium">Shop Potensial → BizDev</h2>
          <p className="mt-1 text-xs text-slate-500">Lead manual dari interaksi creator — masuk pipeline bd_leads (pelengkap lead otomatis M4).</p>
          <form action={submitShopLead} className="mt-3 flex gap-2 rounded-lg border border-slate-200 bg-white p-4">
            <input name="shop_id" required placeholder="Shop ID (numeric)" className={`${input} flex-1`} />
            <button type="submit" className={btn}>Catat Lead</button>
          </form>

          <h2 className="mt-6 text-lg font-medium">Report Kreator (M2) — terbaru</h2>
          <div className="mt-3 rounded-lg border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100 text-sm">
              {(reports ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-2">
                  <span>{name(r.creators)} · {r.period_type} {r.period_start} · <span className="text-xs text-slate-400">{r.status}{r.token_used ? ` · ${r.token_used} token` : " · 0 token"}</span></span>
                  <Link href={`/reports/${r.id}`} className="text-xs underline underline-offset-2">buka</Link>
                </li>
              ))}
              {(reports ?? []).length === 0 && <li className="px-4 py-5 text-center text-slate-400">Belum ada report — generate di <Link href="/reports" className="underline">Report Kreator</Link>.</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* ===== QA: CM mencarikan deals/sample/komisi special tanpa BizDev ===== */}
      <section>
        <h2 className="text-lg font-medium">Deal Hasil CM (tanpa BizDev)</h2>
        <p className="mt-1 text-xs text-slate-500">
          CM mencarikan deals / campaign sample / komisi special untuk kreatornya langsung ke
          brand. Tercatat <code>sourced_by_role=cm</code> — kontribusi CM terlihat di list deal.
        </p>
        {canRequest && (
          <form action={registerCmDeal} className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
            <input name="brand_name" required placeholder="Nama brand (sesuai display platform)" className={input} />
            <input name="shop_id" required inputMode="numeric" pattern="\d+" placeholder="Shop ID (angka)" className={input} />
            <input name="niche" required placeholder="Niche" className={input} />
            <label className="flex items-center gap-2 text-xs text-slate-500">Exp date
              <input type="date" name="exp_date" required className={`${input} flex-1 text-slate-900`} />
            </label>
            <input name="komisi_kreator" required type="number" step="0.1" min="0" max="100" placeholder="Komisi kreator (%)" className={input} />
            <select name="campaign_type" className={input}>
              <option value="paid">Paid campaign</option>
              <option value="sample">Campaign sample (non-berbayar)</option>
              <option value="extra_commission">Komisi extra (non-berbayar)</option>
            </select>
            <select name="creator_id" className={input}>
              <option value="">Untuk creator (opsional)</option>
              {creators.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
            </select>
            <button type="submit" className={`${btn} lg:col-span-2`}>Daftarkan Deal CM</button>
          </form>
        )}
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Deal</th><th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Niche</th><th className="px-4 py-3">Tipe</th>
                <th className="px-4 py-3">Komisi Kreator</th><th className="px-4 py-3">Exp</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(cmDeals ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/deals/${d.id}`} className="text-blue-700 underline">{d.id}</Link>
                  </td>
                  <td className="px-4 py-2 font-medium">{d.brand_name}</td>
                  <td className="px-4 py-2">{d.niche ?? "—"}</td>
                  <td className="px-4 py-2">
                    {d.campaign_type === "sample" ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">sample</span>
                    ) : d.campaign_type === "extra_commission" ? (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">komisi extra</span>
                    ) : "paid"}
                  </td>
                  <td className="px-4 py-2">{d.komisi_kreator_raw ?? "—"}</td>
                  <td className="px-4 py-2">{d.exp_date ?? "—"}</td>
                  <td className="px-4 py-2">{d.status ?? "—"}</td>
                </tr>
              ))}
              {(cmDeals ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-5 text-center text-slate-400">Belum ada deal hasil sourcing CM.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== §2A.7 Kontrak TC/Celeb (e-sign) ===== */}
      {canEsign && (
        <section>
          <h2 className="text-lg font-medium">Kontrak Tertulis TC/Celebrity (E-Sign)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Alur draft → terkirim → ter-sign / kadaluarsa, semua ter-audit. Integrasi provider
            (Privy/Mekari Sign) menunggu keputusan & API key — status diupdate manual sementara.
          </p>
          <form action={createContract} className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <select name="creator_id" required className={input}>
              <option value="">— creator TC/Celeb —</option>
              {creators.filter((c) => c.segment === "tc" || c.segment === "celeb")
                .map((c) => <option key={c.id} value={c.id}>{c.name} ({c.segment})</option>)}
            </select>
            <input name="contract_doc" placeholder="Link dokumen kontrak" className={input} />
            <label className="flex items-center gap-2 text-xs text-slate-500">Kadaluarsa
              <input type="date" name="expires_at" className={`${input} flex-1 text-slate-900`} />
            </label>
            <button type="submit" className={btn}>Buat Draft</button>
          </form>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Creator</th><th className="px-4 py-3">Segmen</th>
                  <th className="px-4 py-3">Status</th><th className="px-4 py-3">Terkirim</th>
                  <th className="px-4 py-3">Ter-sign</th><th className="px-4 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(contracts ?? []).map((k) => (
                  <tr key={k.id}>
                    <td className="px-4 py-2">{name(k.creators)}</td>
                    <td className="px-4 py-2 uppercase">{k.segment}</td>
                    <td className="px-4 py-2">{k.esign_status}{k.provider ? ` (${k.provider})` : ""}</td>
                    <td className="px-4 py-2">{k.sent_at?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-2">{k.signed_at?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {k.esign_status === "draft" && (
                          <form action={transitionContract}>
                            <input type="hidden" name="contract_id" value={k.id} />
                            <input type="hidden" name="step" value="send" />
                            <button type="submit" className={`${btnSmall} bg-slate-900 text-white`}>Kirim</button>
                          </form>
                        )}
                        {k.esign_status === "sent" && (["signed", "expired"] as const).map((s) => (
                          <form key={s} action={transitionContract}>
                            <input type="hidden" name="contract_id" value={k.id} />
                            <input type="hidden" name="step" value={s} />
                            <button type="submit" className={`${btnSmall} ${s === "signed" ? "bg-green-600 text-white" : "bg-slate-200 text-slate-700"}`}>{s === "signed" ? "Tandai ter-sign" : "Kadaluarsa"}</button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {(contracts ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-5 text-center text-slate-400">Belum ada kontrak.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

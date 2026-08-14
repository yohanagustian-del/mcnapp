import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getWeekStart, getWeekDays, formatDayLabel, prevWeek, nextWeek } from "@/lib/schedule/week";
import { buildWeekMatrix } from "@/lib/schedule/matrix";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import { ScheduleBoard, type BoardWeekMatrix } from "./schedule-board";
import { loadPicTapScheduleAlert } from "@/lib/schedule/pic-tap-alerts";
import type { ShopDealOption } from "./slot-form";
import { WeekNav } from "./week-nav";
import { VerifyPanel, type VerifyRow } from "./verify-panel";
import { RosterPanel, type RosterRow } from "./roster-panel";
import { CreatorFilterProvider, CreatorFilterBar, type CmOption } from "@/components/creator-filter";
import { AddCreatorButton } from "./add-creator-form";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CreatorRow {
  id: string;
  name: string;
  username: string | null;
  owner_cpm_id: string | null;
  jenis_creator: string | null;
  live_roster: boolean;
}

interface TeamMemberNameRow {
  id: string;
  name: string;
}

/** Creator row for the "Kelola Roster" panel, with the CM name resolved via join. */
interface FullCreatorRow {
  id: string;
  name: string;
  username: string | null;
  owner_cpm_id: string | null;
  jenis_creator: string | null;
  live_roster: boolean;
  team_members: { name?: string } | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetch EVERY creator for the "Kelola Roster" panel, batching past PostgREST's 1000-row
 * page cap via range() so the full master list (>1000 rows) is complete — matches the
 * creators master tab. Ordered live_roster-first then name; id as final tiebreaker keeps
 * the batches deterministic (no row skipped/duplicated across page boundaries).
 */
async function fetchAllCreators(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<FullCreatorRow[]> {
  const PAGE = 1000;
  const out: FullCreatorRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("creators")
      // Dua FK creators→team_members (CM + Akuisitor): embed CM harus eksplisit.
      .select("id, name, username, owner_cpm_id, jenis_creator, live_roster, team_members!creators_owner_cpm_id_fkey(name)")
      .order("live_roster", { ascending: false })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as unknown as FullCreatorRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const member = await requireMember();
  if (!hasPermission("schedule.view", member.role)) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Akses ditolak — role Anda tidak memiliki izin melihat Jadwal Live.
      </div>
    );
  }
  const canEdit = hasPermission("schedule.edit", member.role);
  const canVerify = hasPermission("schedule.verify", member.role);
  const canRoster = hasPermission("schedule.roster", member.role);
  const isCpm = member.role === "cpm";

  const { week: weekParam } = await searchParams;
  const weekStart =
    weekParam && DATE_RE.test(weekParam) ? weekParam : getWeekStart(new Date());
  const days = getWeekDays(weekStart);
  const weekEnd = days[6];
  const today = todayIso();

  const supabase = await createClient();

  // Roster creators — CPM sees only own creators; everyone else with schedule.view sees all.
  let rosterQuery = supabase
    .from("creators")
    .select("id, name, username, owner_cpm_id, jenis_creator, live_roster")
    .eq("live_roster", true)
    .order("name", { ascending: true })
    .limit(300);
  if (isCpm) rosterQuery = rosterQuery.eq("owner_cpm_id", member.id);

  // Full creator list for the "Kelola Roster" panel — ALL creators, batched past the
  // 1000-row cap (schedule.roster gate already restricts who sees this section).
  const allCreatorsPromise: Promise<FullCreatorRow[]> = canRoster
    ? fetchAllCreators(supabase)
    : Promise.resolve([]);

  // Pilihan brand pada form slot = shop dari tabel "Shop dari Produk TAP" (tab Deal
  // Brand): deal baru didaftarkan sebagai KARTU PRODUK, jadi di sanalah brand yang
  // sedang berjalan hidup — bukan lagi di brand_deals (yang kini khusus deal lama).
  const [{ data: rosterCreators }, allCreators, { data: cpms }, { data: shopSummary }] =
    await Promise.all([
      rosterQuery,
      allCreatorsPromise,
      supabase.from("team_members").select("id, name").eq("role", "cpm"),
      supabase
        .from("products_tap_shop_summary")
        .select("shop_key, shop_name, shop_id, pic_tap_ids, product_count")
        .order("product_count", { ascending: false })
        .limit(500),
    ]);

  const shopOptions: ShopDealOption[] = (shopSummary ?? [])
    .map((s) => ({
      shop_key: s.shop_key as string,
      shop_name: (s.shop_name as string | null) ?? null,
      shop_id: (s.shop_id as string | null) ?? null,
      has_pic_tap: Array.isArray(s.pic_tap_ids) && s.pic_tap_ids.length > 0,
    }))
    .sort((a, b) => (a.shop_name ?? a.shop_key).localeCompare(b.shop_name ?? b.shop_key, "id"));

  // CM names for the calendar rows — scoped to the calendar's roster creators.
  const cmNameByCreator = new Map<string, string>();
  const cpmNameById = new Map(((cpms ?? []) as TeamMemberNameRow[]).map((c) => [c.id, c.name]));
  for (const c of (rosterCreators ?? []) as CreatorRow[]) {
    if (c.owner_cpm_id) cmNameByCreator.set(c.id, cpmNameById.get(c.owner_cpm_id) ?? "—");
  }

  // CM options for the calendar filter — derived from the calendar's roster creators so the
  // dropdown never offers a CM with zero roster creators.
  const cmOptionNameById = new Map<string, string>();
  for (const c of (rosterCreators ?? []) as CreatorRow[]) {
    if (c.owner_cpm_id) cmOptionNameById.set(c.owner_cpm_id, cpmNameById.get(c.owner_cpm_id) ?? "—");
  }
  const cmOptions: CmOption[] = [...cmOptionNameById]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));

  // Every CM (cpm role) in the system — the "Tambah Kreator" dropdown must offer all CMs,
  // not only those who already own a roster creator.
  const allCmOptions: CmOption[] = ((cpms ?? []) as TeamMemberNameRow[])
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));

  // Jenis-kreator options for the calendar filter — from the roster creators actually shown.
  const jenisSet = new Set<string>();
  for (const c of (rosterCreators ?? []) as CreatorRow[]) {
    const j = c.jenis_creator?.trim();
    if (j) jenisSet.add(j);
  }
  const jenisOptions = [...jenisSet].sort((a, b) => a.localeCompare(b, "id"));

  const rosterCreatorIds = ((rosterCreators ?? []) as CreatorRow[]).map((c) => c.id);

  // Slots for this week's 7-day range, scoped to the roster creators in view.
  let slotsQuery = supabase
    .from("live_schedule_slots")
    .select("*")
    .gte("schedule_date", weekStart)
    .lte("schedule_date", weekEnd);
  if (rosterCreatorIds.length > 0) {
    slotsQuery = slotsQuery.in("creator_id", rosterCreatorIds);
  }
  const { data: weekSlots } = rosterCreatorIds.length
    ? await slotsQuery
    : { data: [] as LiveScheduleSlot[] };

  const matrixCreators = ((rosterCreators ?? []) as CreatorRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    owner_cpm_id: c.owner_cpm_id,
    username: c.username,
    jenis_creator: c.jenis_creator,
    cmName: cmNameByCreator.get(c.id) ?? null,
  }));
  // buildWeekMatrix is generic over RosterCreator; matrixCreators is a superset (adds
  // username/cmName for display) so the runtime rows already carry those fields — the
  // cast below just widens the static type to match what ScheduleBoard expects.
  const matrix = buildWeekMatrix(matrixCreators, (weekSlots ?? []) as LiveScheduleSlot[], weekStart) as unknown as BoardWeekMatrix;

  // ===== Verifikasi hari ini + terlewat =====
  let verifyRows: VerifyRow[] = [];
  let overdueRows: VerifyRow[] = [];
  if (canVerify && rosterCreatorIds.length > 0) {
    const { data: pendingSlots } = await supabase
      .from("live_schedule_slots")
      .select("*")
      .in("creator_id", rosterCreatorIds)
      .in("status", ["scheduled", "tentative"])
      .lte("schedule_date", today)
      .order("schedule_date", { ascending: true })
      .limit(300);

    const nameById = new Map(((rosterCreators ?? []) as CreatorRow[]).map((c) => [c.id, c.name]));
    for (const s of (pendingSlots ?? []) as LiveScheduleSlot[]) {
      const row: VerifyRow = { slot: s, creatorName: nameById.get(s.creator_id) ?? s.creator_id };
      if (s.schedule_date === today) verifyRows.push(row);
      else overdueRows.push(row);
    }
  }

  // ===== Kelola Roster =====
  const rosterRows: RosterRow[] = allCreators.map((c) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    owner_cpm_id: c.owner_cpm_id,
    cmName: (c.team_members as unknown as { name?: string } | null)?.name ?? null,
    jenis_creator: c.jenis_creator,
    live_roster: c.live_roster,
  }));

  // Notifikasi PIC TAP — sumber & aturannya SATU dengan badge sidebar
  // (lib/schedule/pic-tap-alerts.ts), di sini ditampilkan rinciannya.
  const picTap = await loadPicTapScheduleAlert(member.id);

  const rangeLabel = `${formatDayLabel(weekStart)} – ${formatDayLabel(weekEnd)}`;

  return (
    <CreatorFilterProvider cms={cmOptions} jenisOptions={jenisOptions}>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Penjadwalan Live Streaming (M13)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kalender mingguan jadwal live kreator celebrity/livestream — pengganti Google Sheet.
            Deterministik, 0 token AI.
          </p>
        </div>

        {picTap.count > 0 && (
          <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
            <p className="text-sm font-medium text-sky-900">
              {picTap.count} jadwal live brand yang Anda pegang sebagai PIC TAP
            </p>
            <ul className="mt-2 space-y-0.5 text-sm text-sky-900/80">
              {picTap.items.slice(0, 8).map((i) => (
                <li key={i.slotId}>
                  {i.scheduleDate}
                  {i.startTime ? ` · ${i.startTime.slice(0, 5)}` : ""} — <strong>{i.brandLabel}</strong>
                </li>
              ))}
            </ul>
            {picTap.items.length > 8 && (
              <p className="mt-1 text-xs text-sky-900/60">
                +{picTap.items.length - 8} jadwal lainnya di kalender di bawah.
              </p>
            )}
            <p className="mt-2 text-xs text-sky-900/60">
              Muncul karena kartu produk brand ini mencantumkan Anda sebagai{" "}
              <strong>PIC TAP</strong> di tab Produk TAP.
            </p>
          </section>
        )}

        <section className="space-y-3">
          <WeekNav
            weekStart={weekStart}
            prevWeekStart={prevWeek(weekStart)}
            nextWeekStart={nextWeek(weekStart)}
            rangeLabel={rangeLabel}
            canEdit={canEdit}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CreatorFilterBar />
            {canRoster && <AddCreatorButton cms={allCmOptions} />}
          </div>
          <ScheduleBoard
            matrix={matrix}
            creators={matrixCreators}
            shops={shopOptions}
            todayIso={today}
            canEdit={canEdit}
          />
        </section>

        {canVerify && (
          <section>
            <h2 className="text-lg font-medium">Verifikasi Hari Ini</h2>
            <p className="mt-1 text-xs text-slate-500">
              CM memverifikasi selama jam kerja; Creator Support di luar jam tersebut. Slot lampau
              yang belum diverifikasi tampil di bagian terpisah.
            </p>
            <div className="mt-3">
              <VerifyPanel todayRows={verifyRows} overdueRows={overdueRows} />
            </div>
          </section>
        )}

        {canRoster && (
          <section>
            <h2 className="text-lg font-medium">Kelola Roster</h2>
            <p className="mt-1 text-xs text-slate-500">
              Seluruh kreator (dari tab Kreator) ada di sini — aktifkan roster live agar muncul di
              kalender di atas. Gunakan pencarian username &amp; filter CM di dalam daftar ini;
              atur jumlah baris per halaman (10 / 50 / 100).
            </p>
            <div className="mt-3">
              <RosterPanel rows={rosterRows} />
            </div>
          </section>
        )}
      </div>
    </CreatorFilterProvider>
  );
}

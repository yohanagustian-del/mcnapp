import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getWeekStart, getWeekDays, formatDayLabel, prevWeek, nextWeek } from "@/lib/schedule/week";
import { buildWeekMatrix } from "@/lib/schedule/matrix";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import { ScheduleBoard, type BoardWeekMatrix } from "./schedule-board";
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

interface DealRow {
  id: string;
  brand_name: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

  // Full creator list for the "Kelola Roster" panel (not scoped — schedule.roster gate
  // already restricts who sees this section; management/CM lead manage roster broadly).
  const fullCreatorsQuery = canRoster
    ? supabase
        .from("creators")
        .select("id, name, username, owner_cpm_id, jenis_creator, live_roster")
        .order("live_roster", { ascending: false })
        .order("name", { ascending: true })
        .limit(200)
    : Promise.resolve({ data: [] as CreatorRow[] });

  const [{ data: rosterCreators }, { data: allCreatorsForRoster }, { data: cpms }, { data: deals }] =
    await Promise.all([
      rosterQuery,
      fullCreatorsQuery,
      supabase.from("team_members").select("id, name").eq("role", "cpm"),
      supabase.from("brand_deals").select("id, brand_name").order("created_at", { ascending: false }).limit(200),
    ]);

  const cmNameByCreator = new Map<string, string>();
  const cpmNameById = new Map(((cpms ?? []) as TeamMemberNameRow[]).map((c) => [c.id, c.name]));
  for (const c of (rosterCreators ?? []) as CreatorRow[]) {
    if (c.owner_cpm_id) cmNameByCreator.set(c.id, cpmNameById.get(c.owner_cpm_id) ?? "—");
  }
  for (const c of (allCreatorsForRoster ?? []) as CreatorRow[]) {
    if (c.owner_cpm_id && !cmNameByCreator.has(c.id)) {
      cmNameByCreator.set(c.id, cpmNameById.get(c.owner_cpm_id) ?? "—");
    }
  }

  // CM options for the multi-select — derived from the creators actually in view (calendar
  // roster + "Kelola Roster" list) so the dropdown never offers a CM with zero creators.
  const cmOptionNameById = new Map<string, string>();
  for (const c of [
    ...((rosterCreators ?? []) as CreatorRow[]),
    ...((allCreatorsForRoster ?? []) as CreatorRow[]),
  ]) {
    if (c.owner_cpm_id) {
      cmOptionNameById.set(c.owner_cpm_id, cpmNameById.get(c.owner_cpm_id) ?? "—");
    }
  }
  const cmOptions: CmOption[] = [...cmOptionNameById]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));

  // Jenis-kreator options for the schedule filter — derived from the creators in view so
  // the dropdown only offers values that actually exist in the data (not hardcoded).
  const jenisSet = new Set<string>();
  for (const c of [
    ...((rosterCreators ?? []) as CreatorRow[]),
    ...((allCreatorsForRoster ?? []) as CreatorRow[]),
  ]) {
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
  const rosterRows: RosterRow[] = ((allCreatorsForRoster ?? []) as CreatorRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    owner_cpm_id: c.owner_cpm_id,
    cmName: cmNameByCreator.get(c.id) ?? null,
    jenis_creator: c.jenis_creator,
    live_roster: c.live_roster,
  }));

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
            {canRoster && <AddCreatorButton cms={cmOptions} />}
          </div>
          <ScheduleBoard
            matrix={matrix}
            creators={matrixCreators}
            deals={(deals ?? []) as DealRow[]}
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
              Hanya kreator dengan roster live aktif yang muncul di kalender di atas. Pencarian
              nama &amp; filter CM di atas juga berlaku untuk daftar ini.
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

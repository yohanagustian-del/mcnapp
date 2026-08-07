import { notFound } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getConfig } from "@/lib/config";
import { filterLiveActive, trackDaily, type CurveShape, type LiveActivityRow } from "@/lib/m7/tracking";
import { canManageProjectParticipants } from "@/lib/m7/access";
import { assignManpower, setProjectStatus, upsertCreatorMetric, upsertDailyMetric } from "../actions";
import { ParticipantForm, type CreatorUsernameOption } from "./participant-form";
import { DailyMetricsTable, type DailyMetricRow } from "./daily-metrics-table";
import { CreatorPerformanceTable, type CreatorPerformanceRow } from "./creator-performance-table";

const STATUS_LABELS: Record<string, string> = {
  on_track: "On-track", behind: "Behind", ahead: "Ahead",
};
const STATUS_STYLES: Record<string, string> = {
  on_track: "bg-green-100 text-green-800", behind: "bg-red-100 text-red-800", ahead: "bg-blue-100 text-blue-800",
};

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const member = await requireMember();
  const canManage = hasPermission("m7.manage", member.role);
  const canMetrics = hasPermission("m7.metrics", member.role);

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("special_projects")
    .select("id, name, type, start_date, end_date, target_gmv, ads_budget_cap, target_creators, daily_target_curve, status, result_summary")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: metrics }, { data: participants }, { data: manpower }, { data: alerts }, tolerance, liveMin] =
    await Promise.all([
      supabase.from("project_daily_metrics")
        .select("date, gmv_actual, ads_spend, creator_commission, mea_revenue")
        .eq("project_id", projectId).order("date"),
      supabase.from("project_participants")
        .select("creator_id, is_external, tiktok_binding_status, live_type, target_gmv, creators(name, username)")
        .eq("project_id", projectId),
      supabase.from("project_manpower")
        .select("member_id, role, involvement, team_members(name)")
        .eq("project_id", projectId),
      supabase.from("platform_alerts")
        .select("id, alert_type, message, created_at")
        .eq("entity_id", String(projectId))
        .in("alert_type", ["project_rugi", "project_over_cap"])
        .eq("resolved", false),
      getConfig<number>("m7.status_tolerance"),
      getConfig<number>("m7.live_active_min"),
    ]);

  const shape = ((project.daily_target_curve as { shape?: CurveShape } | null)?.shape ?? "ramp") as CurveShape;
  const today = new Date().toISOString().slice(0, 10);
  const asOf = project.status === "selesai" ? project.end_date : today < project.start_date ? project.start_date : today;
  const tracking = trackDaily(
    (metrics ?? []).map((m) => ({ date: m.date, gmv: Number(m.gmv_actual ?? 0) })),
    project.start_date, project.end_date, Number(project.target_gmv), tolerance, shape, asOf
  );
  const cumAds = (metrics ?? []).reduce((s, m) => s + Number(m.ads_spend ?? 0), 0);
  const cumMea = (metrics ?? []).reduce((s, m) => s + Number(m.mea_revenue ?? 0), 0);
  const cumKomisiCreator = (metrics ?? []).reduce((s, m) => s + Number(m.creator_commission ?? 0), 0);

  // Live-active helper (PRD §2.3): live GMV ≥ config over the recent ~1 month.
  // Module 0.5 Fase 2: creator_period_summary (satu baris per creator per
  // periode, kolom affiliate_live_gmv langsung) menggantikan platform_metrics_raw
  // per-hari; dipetakan ke bentuk LiveActivityRow yang sama agar filterLiveActive
  // tidak perlu implementasi kedua (CLAUDE.md: satu sumber kebenaran).
  const monthAgo = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
  const { data: liveSummaryRows } = await supabase
    .from("creator_period_summary")
    .select("creator_id, affiliate_live_gmv")
    .gte("period_start", monthAgo)
    .limit(1000);
  const liveRows: LiveActivityRow[] = (liveSummaryRows ?? []).map((r) => ({
    creator_id: r.creator_id, metric: "affiliate_live_gmv", value: r.affiliate_live_gmv,
  }));
  const liveActive = filterLiveActive(liveRows, liveMin);
  const participantIds = new Set((participants ?? []).map((p) => p.creator_id));
  const liveActiveIds = [...liveActive.keys()].filter((cid) => !participantIds.has(cid)).slice(0, 30);
  const { data: liveActiveCreators } = liveActiveIds.length
    ? await supabase.from("creators").select("id, name, username").in("id", liveActiveIds)
    : { data: [] as { id: string; name: string; username: string | null }[] };

  const { data: teamMembers } = canManage
    ? await supabase.from("team_members").select("id, name, role").eq("active", true).order("name").limit(200)
    : { data: [] as { id: string; name: string; role: string }[] };

  // Man power in-charge yang sudah di-assign boleh menambah peserta project ini,
  // walau role globalnya tidak punya m7.manage (M7 §2.5 — aturannya di lib/m7/access).
  const isAssignedManpower = (manpower ?? []).some((m) => m.member_id === member.id);
  const canAddParticipant = canManageProjectParticipants({
    hasManagePermission: canManage,
    isAssignedManpower,
  });

  // Daftar username untuk form peserta — orang hafal handle akun, bukan ID internal.
  // Kreator yang sudah jadi peserta tidak ditawarkan lagi.
  const { data: creatorChoices } = canAddParticipant
    ? await supabase.from("creators").select("id, name, username").not("username", "is", null).order("username").limit(1000)
    : { data: [] as { id: string; name: string; username: string | null }[] };
  const usernameOptions: CreatorUsernameOption[] = (creatorChoices ?? [])
    .filter((c) => Boolean(c.username) && !participantIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, username: c.username as string }));

  // Performa per kreator: sum GMV dari project_creator_metrics per peserta.
  const { data: creatorMetricRows } = await supabase
    .from("project_creator_metrics")
    .select("creator_id, gmv_actual, items_sold")
    .eq("project_id", projectId);
  const creatorGmv = new Map<string, { gmv: number; items: number }>();
  for (const r of creatorMetricRows ?? []) {
    const cur = creatorGmv.get(r.creator_id) ?? { gmv: 0, items: 0 };
    cur.gmv += Number(r.gmv_actual ?? 0);
    cur.items += Number(r.items_sold ?? 0);
    creatorGmv.set(r.creator_id, cur);
  }

  // Baris kedua tabel di bawah dihitung di SERVER (kumulatif/gap dari trackDaily,
  // % target & kontribusi dari agregat di atas); komponen klien hanya mengurutkan
  // dan memaginasi — CLAUDE.md #4, tidak ada perhitungan ulang di UI.
  const adsByDate = new Map(
    (metrics ?? []).map((m) => [m.date, { ads: m.ads_spend, mea: m.mea_revenue }])
  );
  const dailyMetricRows: DailyMetricRow[] = tracking.points.map((pt) => {
    const m = adsByDate.get(pt.date);
    return {
      date: pt.date,
      dayIndex: pt.dayIndex,
      gmvActual: pt.gmvActual,
      cumActual: pt.cumActual,
      cumTarget: pt.cumTarget,
      gap: pt.gap,
      adsSpend: m?.ads === null || m?.ads === undefined ? null : Number(m.ads),
      meaRevenue: m?.mea === null || m?.mea === undefined ? null : Number(m.mea),
    };
  });

  const creatorPerformanceRows: CreatorPerformanceRow[] = (participants ?? []).map((p) => {
    const perf = creatorGmv.get(p.creator_id) ?? { gmv: 0, items: 0 };
    const target = p.target_gmv === null ? null : Number(p.target_gmv);
    return {
      creatorId: p.creator_id,
      creatorName: (p.creators as unknown as { name: string } | null)?.name ?? p.creator_id,
      targetGmv: target,
      gmv: perf.gmv,
      items: perf.items,
      pctTarget: target ? perf.gmv / target : null,
      contribution: tracking.cumActual > 0 ? perf.gmv / tracking.cumActual : 0,
    };
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{project.status}</span>
        {project.type && <span className="text-sm text-slate-400">{project.type}</span>}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {project.start_date} → {project.end_date} · Target {rupiah(project.target_gmv)} · Ads cap {rupiah(project.ads_budget_cap)}
        {project.target_creators ? ` · Target ${project.target_creators} creator` : ""}
      </p>

      {canManage && project.status !== "selesai" && (
        <form action={setProjectStatus} className="mt-3 flex gap-2">
          <input type="hidden" name="project_id" value={project.id} />
          {project.status === "planning" && (
            <button name="status" value="aktif"
              className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600">
              Aktifkan Project
            </button>
          )}
          {project.status === "aktif" && (
            <button name="status" value="selesai"
              className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600">
              Tutup Project (hitung hasil)
            </button>
          )}
        </form>
      )}

      {(alerts ?? []).length > 0 && (
        <div className="mt-4 space-y-2">
          {(alerts ?? []).map((a) => (
            <div key={a.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <span className="mr-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium">{a.alert_type}</span>
              {a.message}
            </div>
          ))}
        </div>
      )}

      {/* ===== Tracking GMV vs target ===== */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Progres GMV</p>
          <p className="mt-1 text-lg font-semibold">{rupiah(tracking.cumActual)}</p>
          <p className="text-xs text-slate-400">vs target kumulatif {rupiah(tracking.cumTarget)} (hari {tracking.daysElapsed}/{tracking.totalDays})</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Status</p>
          <p className="mt-1">
            <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_STYLES[tracking.status]}`}>
              {STATUS_LABELS[tracking.status]}
            </span>
          </p>
          <p className="text-xs text-slate-400">Gap {rupiah(tracking.gap)} · kurva {shape}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Proyeksi Akhir (run-rate)</p>
          <p className="mt-1 text-lg font-semibold">{rupiah(tracking.runRateProjection)}</p>
          <p className="text-xs text-slate-400">{(tracking.achievementPct * 100).toFixed(0)}% dari target tercapai</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Profitabilitas</p>
          <p className={`mt-1 text-lg font-semibold ${cumMea - cumAds < 0 ? "text-red-700" : ""}`}>{rupiah(cumMea - cumAds)}</p>
          <p className="text-xs text-slate-400">
            Revenue MEA {rupiah(cumMea)} − ads {rupiah(cumAds)} · komisi creator {rupiah(cumKomisiCreator)}
          </p>
        </div>
      </div>

      {/* ===== Daily metrics ===== */}
      <h2 className="mt-8 text-lg font-medium">Metrik Harian</h2>
      <p className="mt-1 text-xs text-slate-500">
        Klik judul kolom untuk mengurutkan naik/turun. Baris per halaman bisa diatur 10/20/30.
      </p>
      {canMetrics && project.status !== "selesai" && (
        <form action={upsertDailyMetric}
          className="mt-2 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
          <input type="hidden" name="project_id" value={project.id} />
          <input type="date" name="date" required min={project.start_date} max={project.end_date}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="gmv_actual" placeholder="GMV hari ini (Rp)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="ads_spend" placeholder="Ads spend (Rp)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="creator_commission" placeholder="Komisi creator (Rp)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="mea_revenue" placeholder="Revenue MEA (Rp)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Simpan Hari
          </button>
        </form>
      )}
      <DailyMetricsTable rows={dailyMetricRows} />

      {/* ===== Performa per kreator (QA feedback) ===== */}
      <h2 className="mt-8 text-lg font-medium">Performa per Kreator</h2>
      <p className="mt-1 text-xs text-slate-500">
        Kontribusi GMV tiap kreator peserta vs target masing-masing. Input harian per kreator.
        Klik judul kolom untuk mengurutkan naik/turun; baris per halaman 10/50/100.
      </p>
      {canMetrics && project.status !== "selesai" && (
        <form action={upsertCreatorMetric}
          className="mt-2 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-5">
          <input type="hidden" name="project_id" value={project.id} />
          <select name="creator_id" required className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">— Pilih kreator peserta —</option>
            {(participants ?? []).map((p) => (
              <option key={p.creator_id} value={p.creator_id}>
                {(p.creators as unknown as { name: string } | null)?.name ?? p.creator_id}
              </option>
            ))}
          </select>
          <input type="date" name="date" required min={project.start_date} max={project.end_date}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="gmv_actual" placeholder="GMV kreator hari ini (Rp)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="items_sold" type="number" min="0" placeholder="Item terjual"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Simpan
          </button>
        </form>
      )}
      <CreatorPerformanceTable rows={creatorPerformanceRows} />

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* ===== Participants ===== */}
        <div>
          <h2 className="text-lg font-medium">Peserta ({(participants ?? []).length})</h2>
          {canAddParticipant && (
            <ParticipantForm
              projectId={project.id}
              creators={usernameOptions}
              note={
                isAssignedManpower && !canManage
                  ? "Anda bisa menambah peserta karena sudah di-assign sebagai man power project ini."
                  : undefined
              }
            />
          )}
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Creator</th>
                  <th className="px-4 py-3">Tipe</th>
                  <th className="px-4 py-3">Live</th>
                  <th className="px-4 py-3">Binding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(participants ?? []).map((p) => {
                  const c = p.creators as unknown as { name: string; username: string | null } | null;
                  return (
                  <tr key={p.creator_id}>
                    <td className="px-4 py-2 font-medium">
                      {c?.name ?? p.creator_id}
                      {/* Username = identitas yang dipakai form peserta; ID internal
                          disembunyikan supaya tidak ada lagi yang perlu menghafalnya. */}
                      <span className="ml-1 text-xs text-slate-400">
                        {c?.username ? `@${c.username}` : p.creator_id}
                      </span>
                    </td>
                    <td className="px-4 py-2">{p.is_external ? "External" : "Internal"}</td>
                    <td className="px-4 py-2">
                      {p.live_type === "cohost" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">co-host ⚠</span>
                      ) : "solo"}
                    </td>
                    <td className="px-4 py-2">
                      {p.tiktok_binding_status === "bound" ? "✓ bound" : (
                        <span className="text-red-700">pending</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {(participants ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Belum ada peserta.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {canAddParticipant && (liveActiveCreators ?? []).length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium">
                Filter live-active (GMV live ≥ {rupiah(liveMin)}/bulan) — kandidat internal:
              </p>
              <ul className="mt-1 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                {(liveActiveCreators ?? []).map((c) => (
                  <li key={c.id}>
                    {c.name}{" "}
                    {/* Username ditampilkan supaya bisa langsung diketik di form peserta. */}
                    <span className="text-slate-400">
                      {c.username ? `@${c.username}` : c.id} · live {rupiah(liveActive.get(c.id) ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ===== Man power ===== */}
        <div>
          <h2 className="text-lg font-medium">Man Power In-Charge</h2>
          <p className="mt-1 text-xs text-slate-500">
            Assign anggota tim yang menjalankan project ini. Anggota yang sudah di-assign
            otomatis bisa menambah peserta project, walau role-nya bukan lead.
          </p>
          {canManage && (
            <form action={assignManpower}
              className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-2">
              <input type="hidden" name="project_id" value={project.id} />
              <select name="member_id" required className="rounded-md border border-slate-300 px-3 py-2">
                <option value="">— Pilih anggota tim —</option>
                {(teamMembers ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
                ))}
              </select>
              <input name="role" placeholder="Peran di project (mis. Campaign Ops)"
                className="rounded-md border border-slate-300 px-3 py-2" />
              <input name="involvement" placeholder="Porsi keterlibatan (mis. 50%)"
                className="rounded-md border border-slate-300 px-3 py-2" />
              <button type="submit"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
                Assign
              </button>
            </form>
          )}
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Anggota</th>
                  <th className="px-4 py-3">Peran</th>
                  <th className="px-4 py-3">Keterlibatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(manpower ?? []).map((m) => (
                  <tr key={m.member_id}>
                    <td className="px-4 py-2 font-medium">
                      {(m.team_members as unknown as { name: string } | null)?.name ?? m.member_id}
                      {m.member_id === member.id && (
                        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">
                          Anda
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">{m.role ?? "—"}</td>
                    <td className="px-4 py-2">{m.involvement ?? "—"}</td>
                  </tr>
                ))}
                {(manpower ?? []).length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">Belum ada man power.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {project.status === "selesai" && project.result_summary && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <p className="font-medium">Hasil Project</p>
              {(() => {
                const s = project.result_summary as {
                  achievement_pct?: number; gmv_actual?: number; margin?: number;
                  ads_spend?: number; mea_revenue?: number;
                };
                return (
                  <ul className="mt-1 list-inside list-disc text-xs">
                    <li>Achievement: {((s.achievement_pct ?? 0) * 100).toFixed(0)}% ({rupiah(s.gmv_actual ?? 0)} dari target)</li>
                    <li>Margin akhir: {rupiah(s.margin ?? 0)} (revenue MEA {rupiah(s.mea_revenue ?? 0)} − ads {rupiah(s.ads_spend ?? 0)})</li>
                  </ul>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

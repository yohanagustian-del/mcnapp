import { notFound } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getCachedConfig } from "@/lib/cached";
import { filterLiveActive, trackDaily, type CurveShape, type LiveActivityRow } from "@/lib/m7/tracking";
import { addParticipant, assignManpower, setProjectStatus, updateProject, upsertCreatorMetric, upsertDailyMetric } from "../actions";

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
  const monthAgo = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);

  // ===== Wave 1: independent lookups =====
  // None of these depend on `project`'s data (only on projectId, which is
  // already known), on each other, or on `canManage`/`monthAgo` beyond their
  // own inputs — so all fetch in parallel. `project` itself is included since
  // nothing here needs its columns yet; the notFound() gate just runs after.
  const [
    { data: project },
    { data: metrics },
    { data: participants },
    { data: manpower },
    { data: alerts },
    tolerance,
    liveMin,
    { data: liveSummaryRows },
    { data: teamMembers },
    { data: creatorMetricRows },
  ] = await Promise.all([
    supabase.from("special_projects")
      .select("id, name, type, start_date, end_date, target_gmv, ads_budget_cap, target_creators, daily_target_curve, status, result_summary")
      .eq("id", projectId)
      .maybeSingle(),
    supabase.from("project_daily_metrics")
      .select("date, gmv_actual, ads_spend, creator_commission, mea_revenue")
      .eq("project_id", projectId).order("date"),
    supabase.from("project_participants")
      .select("creator_id, is_external, tiktok_binding_status, live_type, target_gmv, creators(name)")
      .eq("project_id", projectId),
    supabase.from("project_manpower")
      .select("member_id, role, involvement, team_members(name)")
      .eq("project_id", projectId),
    supabase.from("platform_alerts")
      .select("id, alert_type, message, created_at")
      .eq("entity_id", String(projectId))
      .in("alert_type", ["project_rugi", "project_over_cap"])
      .eq("resolved", false),
    getCachedConfig<number>("m7.status_tolerance"),
    getCachedConfig<number>("m7.live_active_min"),
    // Live-active helper (PRD §2.3): live GMV ≥ config over the recent ~1 month.
    // Module 0.5 Fase 2: creator_period_summary (satu baris per creator per
    // periode, kolom affiliate_live_gmv langsung) menggantikan platform_metrics_raw
    // per-hari; dipetakan ke bentuk LiveActivityRow yang sama agar filterLiveActive
    // tidak perlu implementasi kedua (CLAUDE.md: satu sumber kebenaran).
    supabase.from("creator_period_summary")
      .select("creator_id, affiliate_live_gmv")
      .gte("period_start", monthAgo)
      .limit(1000),
    canManage
      ? supabase.from("team_members").select("id, name, role").eq("active", true).order("name").limit(200)
      : Promise.resolve({ data: [] as { id: string; name: string; role: string }[] }),
    // Performa per kreator: sum GMV dari project_creator_metrics per peserta.
    supabase.from("project_creator_metrics")
      .select("creator_id, gmv_actual, items_sold")
      .eq("project_id", projectId),
  ]);

  if (!project) notFound();

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

  const liveRows: LiveActivityRow[] = (liveSummaryRows ?? []).map((r) => ({
    creator_id: r.creator_id, metric: "affiliate_live_gmv", value: r.affiliate_live_gmv,
  }));
  const liveActive = filterLiveActive(liveRows, liveMin);
  const participantIds = new Set((participants ?? []).map((p) => p.creator_id));
  const liveActiveIds = [...liveActive.keys()].filter((cid) => !participantIds.has(cid)).slice(0, 30);

  // ===== Wave 2: depends on wave-1 results (participants + liveActive) =====
  const { data: liveActiveCreators } = liveActiveIds.length
    ? await supabase.from("creators").select("id, name").in("id", liveActiveIds)
    : { data: [] as { id: string; name: string }[] };

  const creatorGmv = new Map<string, { gmv: number; items: number }>();
  for (const r of creatorMetricRows ?? []) {
    const cur = creatorGmv.get(r.creator_id) ?? { gmv: 0, items: 0 };
    cur.gmv += Number(r.gmv_actual ?? 0);
    cur.items += Number(r.items_sold ?? 0);
    creatorGmv.set(r.creator_id, cur);
  }

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

      {canManage && (
        <details className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium">Edit Project</summary>
          <form action={updateProject} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="project_id" value={project.id} />
            <input name="name" required defaultValue={project.name} placeholder="Nama project"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input name="type" defaultValue={project.type ?? ""} placeholder="Tipe (showcase/bootcamp/China trip)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Mulai
              <input type="date" name="start_date" required defaultValue={project.start_date}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Selesai
              <input type="date" name="end_date" required defaultValue={project.end_date}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            </label>
            <input name="target_gmv" required defaultValue={String(project.target_gmv ?? "")} placeholder="Target GMV (Rp)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input name="target_creators" type="number" min="1" defaultValue={project.target_creators ?? ""} placeholder="Target jumlah creator"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input name="ads_budget_cap" defaultValue={project.ads_budget_cap === null ? "" : String(project.ads_budget_cap)} placeholder="Ads budget cap (Rp, opsional)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
              Simpan Perubahan
            </button>
          </form>
        </details>
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
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Tanggal</th>
              <th className="px-4 py-3">GMV</th>
              <th className="px-4 py-3">Kumulatif</th>
              <th className="px-4 py-3">Target Kumulatif</th>
              <th className="px-4 py-3">Gap</th>
              <th className="px-4 py-3">Ads</th>
              <th className="px-4 py-3">Revenue MEA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tracking.points.map((pt) => {
              const m = (metrics ?? []).find((x) => x.date === pt.date);
              return (
                <tr key={pt.date}>
                  <td className="px-4 py-2">{pt.date} <span className="text-xs text-slate-400">H{pt.dayIndex}</span></td>
                  <td className="px-4 py-2">{rupiah(pt.gmvActual)}</td>
                  <td className="px-4 py-2">{rupiah(pt.cumActual)}</td>
                  <td className="px-4 py-2">{rupiah(pt.cumTarget)}</td>
                  <td className={`px-4 py-2 ${pt.gap < 0 ? "text-red-700" : "text-green-700"}`}>{rupiah(pt.gap)}</td>
                  <td className="px-4 py-2">{rupiah(m?.ads_spend)}</td>
                  <td className="px-4 py-2">{rupiah(m?.mea_revenue)}</td>
                </tr>
              );
            })}
            {tracking.points.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Belum ada metrik harian.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Performa per kreator (QA feedback) ===== */}
      <h2 className="mt-8 text-lg font-medium">Performa per Kreator</h2>
      <p className="mt-1 text-xs text-slate-500">
        Kontribusi GMV tiap kreator peserta vs target masing-masing. Input harian per kreator.
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
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">Target GMV</th>
              <th className="px-4 py-3">GMV Aktual</th>
              <th className="px-4 py-3">Item Terjual</th>
              <th className="px-4 py-3">% Target</th>
              <th className="px-4 py-3">Kontribusi Project</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(participants ?? []).map((p) => {
              const perf = creatorGmv.get(p.creator_id) ?? { gmv: 0, items: 0 };
              const target = p.target_gmv === null ? null : Number(p.target_gmv);
              const pct = target ? perf.gmv / target : null;
              const contribution = tracking.cumActual > 0 ? perf.gmv / tracking.cumActual : 0;
              return (
                <tr key={p.creator_id}>
                  <td className="px-4 py-2 font-medium">
                    {(p.creators as unknown as { name: string } | null)?.name ?? p.creator_id}
                    <span className="ml-1 text-xs text-slate-400">{p.creator_id}</span>
                  </td>
                  <td className="px-4 py-2">{rupiah(target)}</td>
                  <td className="px-4 py-2">{rupiah(perf.gmv)}</td>
                  <td className="px-4 py-2">{perf.items || "—"}</td>
                  <td className="px-4 py-2">
                    {pct === null ? "—" : (
                      <span className={pct >= 1 ? "font-medium text-green-700" : pct < 0.5 ? "text-red-700" : "text-amber-700"}>
                        {(pct * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{(contribution * 100).toFixed(0)}%</td>
                </tr>
              );
            })}
            {(participants ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Belum ada peserta.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* ===== Participants ===== */}
        <div>
          <h2 className="text-lg font-medium">Peserta ({(participants ?? []).length})</h2>
          {canManage && (
            <form action={addParticipant}
              className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-2">
              <input type="hidden" name="project_id" value={project.id} />
              <input name="creator_id" required placeholder="CRT-xxxxx"
                className="rounded-md border border-slate-300 px-3 py-2" />
              <input name="target_gmv" placeholder="Target GMV kreator (Rp, opsional)"
                className="rounded-md border border-slate-300 px-3 py-2" />
              <select name="live_type" className="rounded-md border border-slate-300 px-3 py-2">
                <option value="solo">Live solo</option>
                <option value="cohost">Live co-host (cek manual — scale up lebih lama)</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" name="is_external" /> External (wajib binding TikTok)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" name="binding_bound" /> Binding TikTok selesai
              </label>
              <button type="submit"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 sm:col-span-2">
                Tambah Peserta
              </button>
            </form>
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
                {(participants ?? []).map((p) => (
                  <tr key={p.creator_id}>
                    <td className="px-4 py-2 font-medium">
                      {(p.creators as unknown as { name: string } | null)?.name ?? p.creator_id}
                      <span className="ml-1 text-xs text-slate-400">{p.creator_id}</span>
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
                ))}
                {(participants ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Belum ada peserta.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {canManage && (liveActiveCreators ?? []).length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium">
                Filter live-active (GMV live ≥ {rupiah(liveMin)}/bulan) — kandidat internal:
              </p>
              <ul className="mt-1 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                {(liveActiveCreators ?? []).map((c) => (
                  <li key={c.id}>{c.name} <span className="text-slate-400">{c.id} · live {rupiah(liveActive.get(c.id) ?? 0)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ===== Man power ===== */}
        <div>
          <h2 className="text-lg font-medium">Man Power In-Charge</h2>
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
              <select name="role" required defaultValue="" className="rounded-md border border-slate-300 px-3 py-2">
                <option value="" disabled>— Pilih peran —</option>
                <option value="PIC">PIC</option>
                <option value="Anggota">Anggota</option>
              </select>
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
                {[...(manpower ?? [])]
                  .sort((a, b) => (a.role === "PIC" ? -1 : 0) - (b.role === "PIC" ? -1 : 0))
                  .map((m) => (
                    <tr key={m.member_id}>
                      <td className="px-4 py-2 font-medium">
                        {(m.team_members as unknown as { name: string } | null)?.name ?? m.member_id}
                      </td>
                      <td className="px-4 py-2">
                        {m.role === "PIC" ? (
                          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">PIC</span>
                        ) : m.role ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{m.role}</span>
                        ) : "—"}
                      </td>
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

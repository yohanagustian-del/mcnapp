/**
 * M7 Special Project — export "Download Report" (permintaan user 2026-09-28):
 * satu file .xlsx berisi apa yang ada di tab Special Project (ringkasan project,
 * Performa per Kreator, Metrik Harian). Deterministik, tanpa LLM — angkanya
 * dibaca ulang dari sumber yang sama dengan halaman detail project
 * (project_daily_metrics, project_participants, project_creator_metrics),
 * bukan hitung ulang engine baru (CLAUDE.md #4).
 */
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trackDaily, type CurveShape } from "./tracking";
import { getConfig } from "@/lib/config";

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : Math.round(Number(n));

export async function buildProjectOverviewReport(
  admin: SupabaseClient, projectId: number
): Promise<{ filename: string; buffer: ArrayBuffer } | null> {
  const { data: project } = await admin
    .from("special_projects")
    .select("id, name, type, start_date, end_date, target_gmv, ads_budget_cap, target_creators, daily_target_curve, status")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const [{ data: metrics }, { data: participants }, { data: creatorMetricRows }, tolerance] = await Promise.all([
    admin.from("project_daily_metrics")
      .select("date, gmv_actual, gmv_live, ads_spend, creator_commission, mea_revenue")
      .eq("project_id", projectId).order("date"),
    admin.from("project_participants")
      .select(
        "creator_id, target_gmv, analisa, brand_pairs, ads_by, creators(name, owner_cpm_id, team_members!creators_owner_cpm_id_fkey(name))"
      )
      .eq("project_id", projectId),
    admin.from("project_creator_metrics")
      .select("creator_id, gmv_actual, items_sold")
      .eq("project_id", projectId),
    getConfig<number>("m7.status_tolerance"),
  ]);

  const shape = ((project.daily_target_curve as { shape?: CurveShape } | null)?.shape ?? "ramp") as CurveShape;
  const today = new Date().toISOString().slice(0, 10);
  const asOf = project.status === "selesai" ? project.end_date : today < project.start_date ? project.start_date : today;
  const tracking = trackDaily(
    (metrics ?? []).map((m) => ({ date: m.date, gmv: Number(m.gmv_actual ?? 0) })),
    project.start_date, project.end_date, Number(project.target_gmv), tolerance ?? 0.1, shape, asOf
  );
  const cumAds = (metrics ?? []).reduce((s, m) => s + Number(m.ads_spend ?? 0), 0);
  const cumMea = (metrics ?? []).reduce((s, m) => s + Number(m.mea_revenue ?? 0), 0);
  const cumKomisiCreator = (metrics ?? []).reduce((s, m) => s + Number(m.creator_commission ?? 0), 0);
  const cumLiveGmv = (metrics ?? []).reduce((s, m) => s + Number(m.gmv_live ?? 0), 0);
  const liveContribution = tracking.cumActual > 0 ? cumLiveGmv / tracking.cumActual : 0;

  const creatorGmv = new Map<string, { gmv: number; items: number }>();
  for (const r of creatorMetricRows ?? []) {
    const cur = creatorGmv.get(r.creator_id) ?? { gmv: 0, items: 0 };
    cur.gmv += Number(r.gmv_actual ?? 0);
    cur.items += Number(r.items_sold ?? 0);
    creatorGmv.set(r.creator_id, cur);
  }

  const creatorRows = (participants ?? []).map((p) => {
    const perf = creatorGmv.get(p.creator_id) ?? { gmv: 0, items: 0 };
    const target = p.target_gmv === null ? null : Number(p.target_gmv);
    const c = p.creators as unknown as { name: string; owner_cpm_id: string | null; team_members: { name?: string } | null } | null;
    return {
      creatorId: p.creator_id,
      creatorName: c?.name ?? p.creator_id,
      cmName: c?.team_members?.name ?? null,
      targetGmv: target,
      gmv: perf.gmv,
      items: perf.items,
      pctTarget: target ? perf.gmv / target : null,
      contribution: tracking.cumActual > 0 ? perf.gmv / tracking.cumActual : 0,
      analisa: p.analisa ?? null,
      brandPairs: p.brand_pairs ?? null,
      adsBy: ((p.ads_by as string[] | null) ?? []).join(", "),
    };
  });

  const wb = XLSX.utils.book_new();

  const ringkasan = [
    ["RINGKASAN SPECIAL PROJECT"],
    [],
    ["Nama Project", project.name],
    ["Tipe", project.type ?? ""],
    ["Status", project.status],
    ["Mulai", project.start_date],
    ["Selesai", project.end_date],
    ["Target GMV", rupiah(project.target_gmv)],
    ["Target Jumlah Creator", project.target_creators ?? ""],
    ["Ads Budget Cap", rupiah(project.ads_budget_cap)],
    [],
    ["GMV Aktual (kumulatif)", rupiah(tracking.cumActual)],
    ["Target Kumulatif s.d. hari ini", rupiah(tracking.cumTarget)],
    ["Gap", rupiah(tracking.gap)],
    ["Achievement %", `${(tracking.achievementPct * 100).toFixed(1)}%`],
    ["Status Tracking", tracking.status],
    ["Run-rate Proyeksi Akhir Project", rupiah(tracking.runRateProjection)],
    ["Hari Berjalan / Total Hari", `${tracking.daysElapsed} / ${tracking.totalDays}`],
    [],
    ["Total Ads Spend", rupiah(cumAds)],
    ["Total MEA Revenue", rupiah(cumMea)],
    ["Total Komisi Creator", rupiah(cumKomisiCreator)],
    ["Total GMV Live", rupiah(cumLiveGmv)],
    ["Kontribusi Live thd GMV", `${(liveContribution * 100).toFixed(1)}%`],
  ];
  const ringkasanSheet = XLSX.utils.aoa_to_sheet(ringkasan);
  ringkasanSheet["!cols"] = [{ wch: 32 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ringkasanSheet, "Ringkasan");

  const creatorHeader = [
    "Creator", "CM", "Target GMV", "GMV Aktual", "Item Terjual", "% Target",
    "Kontribusi Project", "Analisa", "Brand Pairs", "Ads By",
  ];
  const creatorSheet = XLSX.utils.aoa_to_sheet([
    creatorHeader,
    ...creatorRows.map((r) => [
      r.creatorName, r.cmName ?? "", rupiah(r.targetGmv), rupiah(r.gmv), r.items,
      r.pctTarget === null ? "" : `${(r.pctTarget * 100).toFixed(1)}%`,
      `${(r.contribution * 100).toFixed(1)}%`,
      r.analisa ?? "", r.brandPairs ?? "", r.adsBy,
    ]),
  ]);
  creatorSheet["!cols"] = creatorHeader.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, creatorSheet, "Performa per Kreator");

  const dailyHeader = ["Tanggal", "Hari ke-", "GMV Aktual", "Kumulatif Aktual", "Kumulatif Target", "Gap", "Ads Spend", "MEA Revenue"];
  const adsByDate = new Map((metrics ?? []).map((m) => [m.date, { ads: m.ads_spend, mea: m.mea_revenue }]));
  const dailySheet = XLSX.utils.aoa_to_sheet([
    dailyHeader,
    ...tracking.points.map((pt) => {
      const m = adsByDate.get(pt.date);
      return [
        pt.date, pt.dayIndex, rupiah(pt.gmvActual), rupiah(pt.cumActual), rupiah(pt.cumTarget), rupiah(pt.gap),
        m?.ads === null || m?.ads === undefined ? "" : rupiah(Number(m.ads)),
        m?.mea === null || m?.mea === undefined ? "" : rupiah(Number(m.mea)),
      ];
    }),
  ]);
  dailySheet["!cols"] = dailyHeader.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, dailySheet, "Metrik Harian");

  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
  return { filename: `report_project_${safeName}.xlsx`, buffer };
}

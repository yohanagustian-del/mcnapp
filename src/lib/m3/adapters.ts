// M3 source adapters — read-only queries dari M2/M4/M7/M8.
// PRD §2.6: tiap metric type memetakan ke satu sumber kebenaran; tidak ada kalkulasi ulang.
// Dipanggil hanya dari server actions (scoreWeekly).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdapterResult {
  value: number;
  sourceRef: string;
}

// ─── Metric adapters ───────────────────────────────────────────────────────────

/**
 * binding_count: jumlah creator yang di-closing (pribadi = specialist_id)
 * Sources: M8 acquisitions
 */
export async function bindingCount(
  supabase: SupabaseClient,
  subjectId: string,
  periodStart: string
): Promise<AdapterResult> {
  const { count } = await supabase
    .from("acquisitions")
    .select("id", { count: "exact", head: true })
    .eq("specialist_id", subjectId)
    .gte("binding_date", periodStart);
  return { value: count ?? 0, sourceRef: "acquisitions.specialist_id" };
}

/**
 * binding_hbf_count: creator baru Health/Beauty/Fashion min LS4 atau GMV≥65jt
 * Sources: M8 acquisitions + creators
 */
export async function bindingHbfCount(
  supabase: SupabaseClient,
  subjectId: string,
  periodStart: string
): Promise<AdapterResult> {
  const { data: acqs } = await supabase
    .from("acquisitions")
    .select("creator_id, creators(level, gmv, niche)")
    .eq("specialist_id", subjectId)
    .gte("binding_date", periodStart);

  const HBF_NICHES = ["health", "beauty", "fashion", "kesehatan", "kecantikan", "fashion"];
  const count = (acqs ?? []).filter((a) => {
    const c = a.creators as unknown as { level?: number; gmv?: number; niche?: string } | null;
    if (!c) return false;
    const inNiche = HBF_NICHES.some((n) => c.niche?.toLowerCase().includes(n));
    const eligible = (c.level ?? 0) >= 4 || Number(c.gmv ?? 0) >= 65_000_000;
    return inNiche && eligible;
  }).length;

  return { value: count, sourceRef: "acquisitions+creators(hbf,ls4)" };
}

/**
 * binding_commission_gte20: creator baru dengan komisi ≥ 20%
 * Sources: M8 acquisitions + creators
 */
export async function bindingCommissionGte20(
  supabase: SupabaseClient,
  subjectId: string,
  periodStart: string
): Promise<AdapterResult> {
  const { data: acqs } = await supabase
    .from("acquisitions")
    .select("creator_id, creators(commission_share)")
    .eq("specialist_id", subjectId)
    .gte("binding_date", periodStart);

  const count = (acqs ?? []).filter((a) => {
    const c = a.creators as unknown as { commission_share?: number } | null;
    return Number(c?.commission_share ?? 0) >= 0.20;
  }).length;

  return { value: count, sourceRef: "acquisitions+creators(commission_share)" };
}

/**
 * external_approach_count: jumlah approach creator external
 * Sources: M8 external_approaches
 */
export async function externalApproachCount(
  supabase: SupabaseClient,
  subjectId: string,
  periodStart: string
): Promise<AdapterResult> {
  const { count } = await supabase
    .from("external_approaches")
    .select("id", { count: "exact", head: true })
    .eq("approached_by", subjectId)
    .gte("approach_date", periodStart);
  return { value: count ?? 0, sourceRef: "external_approaches.approached_by" };
}

/**
 * external_conversion_pct: % approach yang berhasil pakai link TAP
 * Sources: M8 external_approaches
 */
export async function externalConversionPct(
  supabase: SupabaseClient,
  subjectId: string,
  periodStart: string
): Promise<AdapterResult> {
  const { data } = await supabase
    .from("external_approaches")
    .select("status")
    .eq("approached_by", subjectId)
    .gte("approach_date", periodStart);

  const rows = data ?? [];
  if (!rows.length) return { value: 0, sourceRef: "external_approaches(conversion)" };
  const success = rows.filter((r) => r.status === "pakai_link").length;
  return {
    value: success / rows.length,
    sourceRef: "external_approaches(pakai_link/total)",
  };
}

/**
 * gmv_portfolio_total: total GMV creator di-handle CPM dalam periode
 * Sources: creator_period_summary (Module 0.5 Fase 2 — repoint dari
 * platform_metrics_raw: semantiknya persis "total GMV creator per periode",
 * satu baris per creator per periode, dan sekaligus memperbaiki bug lama
 * eq("metric","gmv") yang tak pernah match — kolom metric asli platform
 * selalu "affiliate_gmv", bukan "gmv").
 */
export async function gmvPortfolioTotal(
  supabase: SupabaseClient,
  cpmId: string,
  periodStart: string
): Promise<AdapterResult> {
  const { data: creators } = await supabase
    .from("creators")
    .select("id")
    .eq("owner_cpm_id", cpmId);
  const ids = (creators ?? []).map((c) => c.id);
  if (!ids.length) return { value: 0, sourceRef: "creator_period_summary(affiliate_gmv)" };

  const { data: rows } = await supabase
    .from("creator_period_summary")
    .select("affiliate_gmv")
    .in("creator_id", ids)
    .gte("period_start", periodStart);

  const total = (rows ?? []).reduce((s, r) => s + Number(r.affiliate_gmv ?? 0), 0);
  return { value: total, sourceRef: "creator_period_summary.affiliate_gmv" };
}

/**
 * level_up_count: creator yang naik level dibanding baseline snapshot
 * Sources: M2 creators.level + okr_snapshots (baseline)
 */
export async function levelUpCount(
  supabase: SupabaseClient,
  cpmId: string,
  periodStart: string
): Promise<AdapterResult> {
  // Ambil baseline dari okr_snapshots kind='baseline' yang paling dekat period_start
  const { data: snap } = await supabase
    .from("okr_snapshots")
    .select("payload")
    .eq("kind", "baseline")
    .lte("period_start", periodStart)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const baselineLevels = snap?.payload?.creator_levels as Record<string, number> | undefined;
  if (!baselineLevels) {
    return { value: 0, sourceRef: "okr_snapshots(baseline) — belum ada baseline" };
  }

  const { data: creators } = await supabase
    .from("creators")
    .select("id, level")
    .eq("owner_cpm_id", cpmId);

  const count = (creators ?? []).filter((c) => {
    const base = baselineLevels[c.id];
    return base !== undefined && (c.level ?? 0) > base;
  }).length;

  return { value: count, sourceRef: "creators.level vs okr_snapshots(baseline)" };
}

/**
 * special_project_pct: % creator special project yang terpenuhi
 * Sources: M7 special_projects.result_summary
 */
export async function specialProjectPct(supabase: SupabaseClient): Promise<AdapterResult> {
  const { data: projects } = await supabase
    .from("special_projects")
    .select("result_summary, status")
    .eq("status", "selesai");

  const rows = (projects ?? []).filter((p) => p.result_summary);
  if (!rows.length) return { value: 0, sourceRef: "special_projects.result_summary" };

  // result_summary berisi { fulfillment_pct: number } atau { fulfilled: n, total: m }
  const totals = rows.reduce(
    (s, p) => {
      const rs = p.result_summary as { fulfillment_pct?: number; fulfilled?: number; total?: number } | null;
      if (rs?.fulfillment_pct !== undefined) {
        s.sum += rs.fulfillment_pct;
        s.n++;
      } else if (rs?.fulfilled !== undefined && rs?.total) {
        s.sum += rs.fulfilled / rs.total;
        s.n++;
      }
      return s;
    },
    { sum: 0, n: 0 }
  );
  const pct = totals.n > 0 ? totals.sum / totals.n : 0;
  return { value: pct, sourceRef: "special_projects.result_summary(avg_fulfillment)" };
}

/**
 * Dispatch ke adapter berdasarkan metric name.
 * Mengembalikan null bila metric belum diimplementasikan.
 */
export async function getActualForMetric(
  supabase: SupabaseClient,
  metric: string,
  subjectId: string,
  periodStart: string,
  _filterJson: Record<string, unknown> | null
): Promise<AdapterResult | null> {
  switch (metric) {
    case "binding_count":            return bindingCount(supabase, subjectId, periodStart);
    case "binding_hbf_count":        return bindingHbfCount(supabase, subjectId, periodStart);
    case "binding_commission_gte20": return bindingCommissionGte20(supabase, subjectId, periodStart);
    case "external_approach_count":  return externalApproachCount(supabase, subjectId, periodStart);
    case "external_conversion_pct":  return externalConversionPct(supabase, subjectId, periodStart);
    case "gmv_portfolio_total":      return gmvPortfolioTotal(supabase, subjectId, periodStart);
    case "level_up_count":           return levelUpCount(supabase, subjectId, periodStart);
    case "special_project_pct":      return specialProjectPct(supabase);
    default:
      return null; // metric belum diimplementasikan adapter-nya
  }
}

/** Ambil hands-on ratio untuk seorang CPM dalam window N hari terakhir. */
export async function getHandsOnRatio(
  supabase: SupabaseClient,
  cpmId: string,
  windowDays: number
): Promise<number | null> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceStr = since.toISOString().split("T")[0];

  // Creator yang di-handle CPM ini
  const { data: creators } = await supabase
    .from("creators")
    .select("id, gmv")
    .eq("owner_cpm_id", cpmId);
  if (!creators?.length) return null;

  const ids = creators.map((c) => c.id);

  // GMV snapshot: ambil nilai GMV periode terakhir SEBELUM window (baseline
  // delta) — Module 0.5 Fase 2: creator_period_summary (satu baris per
  // creator per periode) menggantikan platform_metrics_raw per-hari; juga
  // memperbaiki bug lama eq("metric","gmv") yang tak pernah match kolom
  // metric asli ("affiliate_gmv").
  const { data: prevMetrics } = await supabase
    .from("creator_period_summary")
    .select("creator_id, affiliate_gmv, period_start")
    .in("creator_id", ids)
    .lt("period_start", sinceStr)
    .order("period_start", { ascending: false });

  const prevByCreator = new Map<string, number>();
  for (const r of prevMetrics ?? []) {
    if (!prevByCreator.has(r.creator_id)) {
      prevByCreator.set(r.creator_id, Number(r.affiliate_gmv ?? 0));
    }
  }

  // Aktivitas CPM dalam window: req sample/ads/HSL + report log + campaign assignment
  const [{ data: creatorReqs }, { data: reportLogs }, { data: campaignAssigned }] =
    await Promise.all([
      supabase
        .from("creator_requests")
        .select("creator_id")
        .in("creator_id", ids)
        .gte("created_at", sinceStr),
      supabase
        .from("cpm_report_activity")
        .select("creator_id")
        .eq("cpm_id", cpmId)
        .gte("generated_at", sinceStr),
      supabase
        .from("campaign_requests")
        .select("creator_id")
        .eq("owner_cpm_id", cpmId)
        .gte("created_at", sinceStr),
    ]);

  const activeCreators = new Set<string>([
    ...(creatorReqs ?? []).map((r) => r.creator_id as string),
    ...(reportLogs ?? []).map((r) => r.creator_id as string),
    ...(campaignAssigned ?? []).map((r) => r.creator_id as string),
  ]);

  const activities = creators.map((c) => ({
    creator_id: c.id,
    gmv_delta: Number(c.gmv ?? 0) - (prevByCreator.get(c.id) ?? 0),
    has_activity: activeCreators.has(c.id),
  }));

  // Import handsOnRatio from scoring (pure)
  const { handsOnRatio } = await import("./scoring");
  return handsOnRatio(activities);
}

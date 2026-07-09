"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission, type TeamMember } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  breakdownGmv,
  computeDelta,
  deriveMetrics,
  periodBounds,
  shouldSkipInsight,
  sumMetrics,
  totalsFromPeriodSummary,
  topSubCategoriesFromProducts,
  type DerivedMetrics,
  type PeriodSummaryRow,
  type PeriodType,
  type RawMetricRow,
  type TopProductRow,
} from "@/lib/report/aggregate";
import { generateInsight, insightAvailable } from "@/lib/report/insight";

export interface ReportActionState {
  ok: boolean;
  message: string;
  reportId?: number;
}

const generateSchema = z.object({
  creator_id: z.string().min(1, "Creator wajib dipilih"),
  period_type: z.enum(["weekly", "monthly"]),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal awal periode wajib"),
});

/** CPM may only act on creators they own (PRD M2 §2.5 — server-enforced). */
async function assertCreatorScope(actor: TeamMember, ownerCpmId: string | null) {
  if (actor.role === "cpm" && ownerCpmId !== actor.id) {
    throw new Error("Akses ditolak: CPM hanya bisa membuat report untuk creator yang di-handle sendiri");
  }
}

/**
 * M2 on-demand generate (PRD §3.3 = pipeline §3.1 steps 3-6 for one creator):
 * deterministic data layer → skip-LLM gate → optional single insight call →
 * draft report + cpm_report_activity + audit + token-baseline ratchet.
 */
export async function generateReport(
  _prev: ReportActionState | null,
  formData: FormData
): Promise<ReportActionState> {
  const actor = await requirePermission("reports.generate");
  const parsed = generateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { creator_id, period_type, period_start } = parsed.data;
  const periodType = period_type as PeriodType;

  const supabase = await createClient();
  const { data: creator } = await supabase
    .from("creators")
    .select("id, name, niche, level, status, contract_end_date, commission_share, owner_cpm_id")
    .eq("id", creator_id)
    .maybeSingle();
  if (!creator) return { ok: false, message: `Creator ${creator_id} tidak ditemukan` };
  await assertCreatorScope(actor, creator.owner_cpm_id);

  const bounds = periodBounds(periodType, period_start);

  // ===== Module 0.5 Fase 2: creator_period_summary + creator_top_products are
  // the source of truth for M2 totals — report can be generated WITHOUT a
  // fresh upload. Take the latest batch (by created_at) per period when a
  // period has more than one (re-upload/correction), same convention as M8
  // (src/lib/m8/routing.ts latestTwoPeriods). Fallback: if this creator has no
  // period-summary row yet for the CURRENT period (older creators / not yet
  // migrated through /ingest or /metrics since Fase 2 shipped), fall back to
  // summing platform_metrics_raw directly — preserves the pre-existing
  // behavior instead of silently reporting zero, which is the lower-risk
  // choice while both write paths coexist.
  const fetchPeriodSummary = (start: string, end: string) =>
    fetchAll<{ period_start: string; created_at: string; gmv_total: number | null; affiliate_gmv: number | null; affiliate_live_gmv: number | null; affiliate_video_gmv: number | null; orders: number | null }>(
      supabase, "creator_period_summary",
      "period_start, created_at, gmv_total, affiliate_gmv, affiliate_live_gmv, affiliate_video_gmv, orders",
      (q) => q.eq("creator_id", creator_id).gte("period_start", start).lt("period_start", end));
  const [currentSummaryRows, previousSummaryRows] = await Promise.all([
    fetchPeriodSummary(bounds.start, bounds.end),
    fetchPeriodSummary(bounds.prevStart, bounds.prevEnd),
  ]);
  const latestByCreatedAt = (rows: typeof currentSummaryRows): PeriodSummaryRow | null =>
    rows.length === 0 ? null : rows.reduce((a, b) => (b.created_at > a.created_at ? b : a));

  const usingAggregateSource = currentSummaryRows.length > 0;

  let current: DerivedMetrics;
  let previous: DerivedMetrics;
  let bySource: Record<string, number>;
  let topSubCategories: { sub_category: string; gmv: number }[];

  if (usingAggregateSource) {
    current = deriveMetrics(totalsFromPeriodSummary(latestByCreatedAt(currentSummaryRows)));
    previous = deriveMetrics(totalsFromPeriodSummary(latestByCreatedAt(previousSummaryRows)));
    const topProducts = await fetchAll<TopProductRow>(
      supabase, "creator_top_products", "level2_category, gmv",
      (q) => q.eq("creator_id", creator_id).gte("period_start", bounds.start).lt("period_start", bounds.end));
    bySource = {}; // no source dimension on the aggregate tables (Module 0.5 §2.3)
    topSubCategories = topSubCategoriesFromProducts(topProducts);
    if (topSubCategories.length === 0) {
      // /metrics-sourced batches have no product grain (no creator_top_products
      // rows) — fall back to the per-subcategory GMV kept in platform_metrics_raw.
      const subCatRows = await fetchAll<RawMetricRow>(
        supabase, "platform_metrics_raw", "metric, value, source, sub_category",
        (q) => q.eq("creator_id", creator_id).eq("metric", "affiliate_gmv")
          .not("sub_category", "is", null).gte("period", bounds.start).lt("period", bounds.end));
      topSubCategories = breakdownGmv(subCatRows).topSubCategories;
    }
  } else {
    const fetchPeriod = (start: string, end: string) =>
      fetchAll<RawMetricRow>(supabase, "platform_metrics_raw", "metric, value, source, sub_category",
        (q) => q.eq("creator_id", creator_id).gte("period", start).lt("period", end));
    const [currentRows, previousRows] = await Promise.all([
      fetchPeriod(bounds.start, bounds.end),
      fetchPeriod(bounds.prevStart, bounds.prevEnd),
    ]);
    if (currentRows.length === 0) {
      return { ok: false, message: `Tidak ada data periode untuk ${creator.name} pada ${bounds.start} — upload dulu di /ingest atau Data Platform.` };
    }
    current = deriveMetrics(sumMetrics(currentRows));
    previous = deriveMetrics(sumMetrics(previousRows));
    const breakdown = breakdownGmv(currentRows);
    bySource = breakdown.bySource;
    topSubCategories = breakdown.topSubCategories;
  }

  const deltas = {
    gmv: computeDelta(current.gmv, previous.gmv),
    views: computeDelta(current.views, previous.views),
    orders: computeDelta(current.orders, previous.orders),
    live_gmv: computeDelta(current.live_gmv, previous.live_gmv),
  };

  // Benchmark vs peers in the same niche (aggregate & anonymous — PRD §2.3).
  let benchmark: { niche: string; peers: number; peer_avg_gmv: number } | null = null;
  if (creator.niche) {
    const { data: peers } = await supabase
      .from("creators").select("id").eq("niche", creator.niche).neq("id", creator_id).limit(200);
    const peerIds = (peers ?? []).map((p) => p.id);
    if (peerIds.length > 0) {
      const peerRows = await fetchAll<{ creator_id: string; value: number | null }>(
        supabase, "platform_metrics_raw", "creator_id, value",
        (q) => q.in("creator_id", peerIds).eq("metric", "affiliate_gmv").is("sub_category", null)
          .gte("period", bounds.start).lt("period", bounds.end));
      const byPeer = new Map<string, number>();
      for (const r of peerRows) byPeer.set(r.creator_id, (byPeer.get(r.creator_id) ?? 0) + Number(r.value ?? 0));
      if (byPeer.size > 0) {
        const total = [...byPeer.values()].reduce((a, b) => a + b, 0);
        benchmark = { niche: creator.niche, peers: byPeer.size, peer_avg_gmv: total / byPeer.size };
      }
    }
  }

  // Contract & link-leakage surface (M1 alert + M4 status — surfaced, not recomputed).
  const today = new Date().toISOString().slice(0, 10);
  const contractAlert =
    creator.contract_end_date && creator.contract_end_date <= addDays(today, 30)
      ? { contract_end_date: creator.contract_end_date, expired: creator.contract_end_date < today }
      : null;
  const { data: linkStatus } = await supabase
    .from("creator_link_status")
    .select("week, leak_ratio, link_status")
    .eq("creator_id", creator_id)
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dataJson = {
    creator: { id: creator.id, name: creator.name, niche: creator.niche, level: creator.level },
    period: { type: periodType, start: bounds.start, end_exclusive: bounds.end, prev_start: bounds.prevStart },
    metrics: current,
    previous,
    deltas,
    gmv_by_source: bySource,
    top_sub_categories: topSubCategories,
    benchmark,
    contract_alert: contractAlert,
    link_leakage: linkStatus ?? null,
    level_position: creator.level
      ? { current_level: creator.level, next_level: Math.min(creator.level + 1, 6) }
      : null,
  };

  // ===== Gate + insight layer (≤1 LLM call) =====
  const threshold = await getConfig<number>("m2.delta_threshold");
  const skip = shouldSkipInsight(periodType, deltas, threshold) || creator.status === "nonaktif";

  let insightDraft: string | null = null;
  let tokenUsed = 0;
  let insightNote = "";
  if (skip) {
    insightNote = `Data-only: delta ≤ ${(threshold * 100).toFixed(0)}% (gate skip-LLM), 0 token.`;
  } else if (!insightAvailable()) {
    insightNote = "ANTHROPIC_API_KEY belum di-set — report tersimpan data-only, insight bisa digenerate ulang nanti.";
  } else {
    // LLM failure must not lose the deterministic report — degrade to data-only.
    try {
      const result = await generateInsight({
        creator: dataJson.creator,
        period: dataJson.period,
        metrics: current,
        deltas,
        gmv_by_source: bySource,
        top_sub_categories: topSubCategories,
        benchmark,
        contract_alert: contractAlert,
        link_leakage: dataJson.link_leakage,
        level_position: dataJson.level_position,
      });
      insightDraft = result.text;
      tokenUsed = result.tokensUsed;
      insightNote = `Insight draft dibuat (${tokenUsed} token).`;
    } catch (e) {
      insightNote = `Insight LLM gagal (${e instanceof Error ? e.message.slice(0, 120) : "error"}) — report tersimpan data-only, insight bisa digenerate ulang nanti.`;
    }
  }

  // ===== Persist (service role — users have read-only access to reports) =====
  const admin = createAdminClient();
  const { data: report, error } = await admin
    .from("creator_reports")
    .insert({
      creator_id,
      period_type: periodType,
      period_start: bounds.start,
      data_json: dataJson,
      insight_draft: insightDraft,
      status: "draft",
      token_used: tokenUsed,
      generated_by: actor.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Gagal menyimpan report: ${error.message}` };

  await admin.from("cpm_report_activity").insert({
    cpm_id: actor.id,
    creator_id,
    period_type: periodType,
    has_insight: insightDraft !== null,
  });

  await writeAudit({
    actorId: actor.id,
    action: "report.generate",
    entityType: "creator_reports",
    entityId: String(report.id),
    after: { creator_id, period_type: periodType, period_start: bounds.start, token_used: tokenUsed, has_insight: insightDraft !== null },
    type: "auto",
  });

  // Token ratchet (PRD §2.7): best-today = minimum-tomorrow; regression → flag.
  if (insightDraft !== null && tokenUsed > 0) {
    const { data: baseline } = await admin
      .from("token_baseline").select("best_token").eq("report_type", periodType).maybeSingle();
    if (!baseline || tokenUsed < baseline.best_token) {
      await admin.from("token_baseline").upsert(
        { report_type: periodType, best_token: tokenUsed, updated_at: new Date().toISOString() },
        { onConflict: "report_type" }
      );
    } else if (tokenUsed > baseline.best_token) {
      const message = `Report #${report.id} memakai ${tokenUsed} token > baseline ${baseline.best_token} (${periodType}) — regresi efisiensi`;
      await admin.from("platform_alerts").insert({
        alert_type: "token_regression", entity_type: "creator_reports", entity_id: String(report.id),
        message, payload: { token_used: tokenUsed, best_token: baseline.best_token },
      });
      await writeAudit({
        actorId: null,
        action: "m2.token_regression",
        entityType: "creator_reports",
        entityId: String(report.id),
        after: { token_used: tokenUsed, best_token: baseline.best_token },
        type: "platform_alert",
      });
    }
  }

  revalidatePath("/reports");
  return { ok: true, message: `Report ${creator.name} (${periodType}, ${bounds.start}) tersimpan sebagai draft. ${insightNote}`, reportId: report.id };
}

/**
 * Finalize (PRD §3.2 human-in-the-loop): reviewer edits the draft insight,
 * then locks the report as Final. Export = print view on the detail page.
 */
export async function finalizeReport(
  _prev: ReportActionState | null,
  formData: FormData
): Promise<ReportActionState> {
  const actor = await requirePermission("reports.finalize");
  const reportId = Number(formData.get("report_id"));
  const insightFinal = String(formData.get("insight_final") ?? "").trim();
  if (!Number.isInteger(reportId)) return { ok: false, message: "report_id tidak valid" };

  const supabase = await createClient();
  const { data: report } = await supabase
    .from("creator_reports")
    .select("id, status, insight_draft, creator_id, creators(owner_cpm_id)")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { ok: false, message: `Report #${reportId} tidak ditemukan` };
  if (report.status === "final") return { ok: false, message: "Report sudah final." };
  await assertCreatorScope(actor, (report.creators as unknown as { owner_cpm_id: string | null } | null)?.owner_cpm_id ?? null);

  const admin = createAdminClient();
  const { error } = await admin
    .from("creator_reports")
    .update({
      status: "final",
      insight_final: insightFinal || report.insight_draft,
      finalized_by: actor.id,
    })
    .eq("id", reportId);
  if (error) return { ok: false, message: `Gagal finalisasi: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "report.finalize",
    entityType: "creator_reports",
    entityId: String(reportId),
    before: { status: report.status },
    after: { status: "final", edited: insightFinal !== "" && insightFinal !== report.insight_draft },
    type: "auto",
  });

  revalidatePath("/reports");
  revalidatePath(`/reports/${reportId}`);
  return { ok: true, message: `Report #${reportId} difinalisasi. Siap di-export (print → PDF).`, reportId };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

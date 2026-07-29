import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";

/**
 * Retention cleanup for M4 leak data — extracted from src/lib/ingest/run.ts so both
 * leak writers can import it without a module cycle (run.ts now also calls the leak
 * analysis, and the analysis needs this cleanup). run.ts re-exports it, so existing
 * importers of `enforceLeakRetention` from "./run" keep working unchanged.
 */

/** Subtract `weeks * 7` days from an ISO date (YYYY-MM-DD) → ISO date string. */
function minusWeeks(isoDate: string, weeks: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic retention cleanup (CLAUDE.md #2, 0 LLM) for M4 leak data, run after
 * a leak rollup is written. Windows come from app_config (never hardcoded):
 *   - leakage_products (per-product DETAIL, historical engine-era rows): retention.leak_detail_weeks
 *   - creator_link_status (per-creator SUMMARY): retention.leak_summary_weeks
 * Cutoff is relative to this period's period_start so a re-run of an old period
 * doesn't prematurely prune newer data. Audit (type auto) written only when rows
 * were actually deleted — no-op runs stay silent.
 *
 * Callers: the in-platform analysis (src/lib/m4/leak-analysis.ts) and the legacy
 * artifact upload (src/lib/ingest/leak-run.ts).
 */
export async function enforceLeakRetention(
  admin: SupabaseClient,
  periodStart: string
): Promise<void> {
  const [detailWeeks, summaryWeeks] = await Promise.all([
    getConfig<number>("retention.leak_detail_weeks"),
    getConfig<number>("retention.leak_summary_weeks"),
  ]);
  const detailCutoff = minusWeeks(periodStart, detailWeeks);
  const summaryCutoff = minusWeeks(periodStart, summaryWeeks);

  const { data: delDetail, error: detailErr } = await admin
    .from("leakage_products").delete().lt("week", detailCutoff).select("id");
  if (detailErr) throw new Error(`Gagal retensi leakage_products: ${detailErr.message}`);

  const { data: delSummary, error: summaryErr } = await admin
    .from("creator_link_status").delete().lt("week", summaryCutoff).select("creator_id");
  if (summaryErr) throw new Error(`Gagal retensi creator_link_status: ${summaryErr.message}`);

  const detailDeleted = delDetail?.length ?? 0;
  const summaryDeleted = delSummary?.length ?? 0;
  if (detailDeleted === 0 && summaryDeleted === 0) return;

  await writeAudit({
    actorId: null,
    actorLabel: "system:retention",
    action: "retention.leak_cleanup",
    entityType: "leakage_products",
    entityId: periodStart,
    after: {
      period_start: periodStart,
      leak_detail_weeks: detailWeeks,
      leak_summary_weeks: summaryWeeks,
      detail_cutoff: detailCutoff,
      summary_cutoff: summaryCutoff,
      leakage_products_deleted: detailDeleted,
      creator_link_status_deleted: summaryDeleted,
    },
    type: "auto",
  });
}

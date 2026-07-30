import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { resolveCreatorNames } from "@/lib/platform-csv";
import { recordPendingCreators, pendingSkipReason } from "@/lib/creators/pending";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { validateW1W5Period } from "@/lib/utils/date";
import { derivePeriod, parseMcnFile, parseTapFile, type SkippedRow } from "@/lib/ingest/parse";
import type { McnRow, TapRow } from "@/lib/ingest/schema";
import { enforceLeakRetention } from "@/lib/ingest/leak-retention";
import {
  computeLeak, normalizeShopId,
  type BdOpportunityShop, type CreatorLeakRollup, type LeakComputeResult, type MasterShopEntry,
} from "./leak-compute";
import { parseMasterShopFile } from "./master-shop-file";
import { pruneLeakExports, writeLeakExports, type LeakExportFile } from "./leak-export";

/**
 * M4 weekly link-leakage analysis — orchestrator (deterministic, 0 token AI).
 *
 * Replaces the external "Agency Leaked Generator" artifact: the platform now takes
 * the same weekly platform exports (MCN + TAP) and computes the leak itself
 * (computeLeak, src/lib/m4/leak-compute.ts), then persists ONLY the rollup:
 *   - creator_link_status  (per creator × week, source='platform')
 *   - leak_week_summary    (CM-level totals, source_format='platform')
 *   - bd_leads             (shops without an active deal, source='platform')
 *   - platform_alerts      (link_bocor / deal_expiring / deal_expired) + audit_logs
 * Per-product detail is NOT written to Postgres (interview decision: rollup saja);
 * it is exported as a CSV backup to a private Storage bucket instead.
 *
 * Two entry points, ONE pipeline:
 *   - runLeakAnalysis(...)          → from already-parsed rows; used by /ingest Lane 1
 *                                     so the weekly files are parsed only once.
 *   - runLeakAnalysisFromFiles(...) → parses the files first; used by the standalone
 *                                     form on /link-leakage (re-run / minggu terlewat).
 *
 * The partnered-shop master is either the platform's own cooperating_shops table
 * (default) or an uploaded "Master Data Shop" file (the artifact's third input,
 * for weeks where the DB master is still incomplete). When a file is used, the DB
 * is still consulted for deal_end/deal_id of those shops so deal-expiry alerts
 * keep working.
 */

export type MasterSource = "db" | "file";
export type LeakAnalysisOrigin = "ingest" | "link_leakage";

export interface LeakAnalysisCreator {
  creatorId: string;
  creatorName: string;
  linkStatus: string;
  leakRatio: number | null;
  leakRatioShopBasis: number | null;
  gmvBocor: number;
  gmvBocorShopBasis: number;
  gmvAffiliateTotal: number;
  gmvTap: number;
  gmvDealTotal: number;
  bdOpportunityGmv: number;
  directGmv: number;
  effectiveness: number | null;
}

export interface LeakAnalysisResult {
  week: string;
  periodStart: string;
  periodEnd: string;
  masterSource: MasterSource;
  /** How many shops the master contributed (file rows or cooperating_shops rows). */
  masterShops: number;
  /** Shops treated as ber-deal this week (master ∪ shops with TAP GMV). */
  partneredShops: number;
  creators: LeakAnalysisCreator[];
  totals: LeakComputeResult["totals"];
  bdShopsTop: BdOpportunityShop[];
  bdLeadsNew: number;
  bdLeadsUpdated: number;
  detailRows: number;
  alerts: { bocor: number; dealExpiring: number; dealExpired: number };
  exports: LeakExportFile[];
  /** Username belum terdaftar → daftar tunggu, datanya dilewati (migration 0028). */
  pendingCreators: string[];
  warnings: string[];
  skipped: SkippedRow[];
}

export interface RunLeakAnalysisInput {
  mcnRows: McnRow[];
  tapRows: TapRow[];
  /** Optional "Master Data Shop" upload; omitted ⇒ cooperating_shops is the master. */
  masterFile?: File | null;
  periodStart: string;
  periodEnd: string;
  actorId: string;
  origin: LeakAnalysisOrigin;
  /** Parser notes from the caller (Lane 1 already collected them). */
  skipped?: SkippedRow[];
}

interface CooperatingShopRow {
  shop_id: string;
  shop_name: string | null;
  deal_id: string | null;
  deal_end: string | null;
}

/**
 * Builds the partnered-shop master. `file` wins when provided (the CM explicitly
 * chose the artifact-style input because the DB master is incomplete), but deal
 * metadata from cooperating_shops is merged in for the shops it knows.
 */
async function buildMaster(
  admin: SupabaseClient,
  masterFile: File | null | undefined
): Promise<{
  master: Map<string, MasterShopEntry>;
  source: MasterSource;
  count: number;
  dbShops: CooperatingShopRow[];
  warnings: string[];
}> {
  const dbShops = await fetchAll<CooperatingShopRow>(
    admin,
    "cooperating_shops",
    "shop_id, shop_name, deal_id, deal_end",
    (q) => q
  );
  const dbByShop = new Map<string, CooperatingShopRow>();
  for (const s of dbShops) dbByShop.set(normalizeShopId(String(s.shop_id)), s);

  if (masterFile) {
    const parsed = await parseMasterShopFile(masterFile);
    const master = new Map<string, MasterShopEntry>();
    for (const raw of parsed.shopIds) {
      const key = normalizeShopId(raw);
      const db = dbByShop.get(key);
      master.set(key, {
        shopId: key,
        shopName: parsed.shopNames.get(raw) ?? db?.shop_name ?? null,
        dealId: db?.deal_id ?? null,
        dealEnd: db?.deal_end ?? null,
      });
    }
    const warnings = [...parsed.warnings];
    warnings.push(
      `Master shop dipakai dari FILE upload (sheet "${parsed.sheetName}", ${master.size} shop) — ` +
        `tabel cooperating_shops tidak diubah. deal_end (untuk alert kadaluarsa) diambil dari DB ` +
        `untuk shop yang sudah terdaftar di sana.`
    );
    return { master, source: "file", count: master.size, dbShops, warnings };
  }

  const master = new Map<string, MasterShopEntry>();
  for (const [key, s] of dbByShop) {
    master.set(key, {
      shopId: key,
      shopName: s.shop_name,
      dealId: s.deal_id,
      dealEnd: s.deal_end,
    });
  }
  const warnings: string[] = [];
  if (master.size === 0) {
    warnings.push(
      "Master shop di database (cooperating_shops) KOSONG — hanya shop yang punya GMV di file TAP " +
        "yang dianggap ber-deal; sisanya masuk peluang BD. Refresh master shop dulu, atau upload " +
        "file Master Data Shop, lalu jalankan ulang analisa untuk angka yang akurat."
    );
  }
  return { master, source: "db", count: master.size, dbShops, warnings };
}

/**
 * Persists the per-creator rollup with delete-then-insert scoped to (week, ONLY the
 * creators in this run) — the same semantics as the artifact writer (leak-rollup.ts):
 * another CM uploading the same week for other creators must not be wiped.
 */
async function writeComputedRollups(
  admin: SupabaseClient,
  week: string,
  rows: Array<CreatorLeakRollup & { creatorId: string }>
): Promise<void> {
  if (rows.length === 0) return;
  const creatorIds = rows.map((r) => r.creatorId);
  for (let i = 0; i < creatorIds.length; i += 200) {
    const { error } = await admin
      .from("creator_link_status")
      .delete()
      .eq("week", week)
      .in("creator_id", creatorIds.slice(i, i + 200));
    if (error) throw new Error(`Gagal reset creator_link_status: ${error.message}`);
  }

  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    creator_id: r.creatorId,
    week,
    gmv_deal_total: r.gmvDealTotal,
    gmv_bocor: r.gmvBocor,
    leak_ratio: r.leakRatio,
    link_status: r.linkStatus,
    gmv_affiliate_total: r.gmvAffiliateTotal,
    gmv_tap: r.gmvTap,
    bd_opportunity_gmv: r.bdOpportunityGmv,
    direct_gmv: r.directGmv,
    gmv_bocor_shop_basis: r.gmvBocorShopBasis,
    leak_ratio_shop_basis: r.leakRatioShopBasis,
    source: "platform",
    computed_at: now,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin.from("creator_link_status").insert(payload.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis creator_link_status: ${error.message}`);
  }
}

/** CM-level weekly totals — delete-then-insert on (week, uploaded_by), like the artifact path. */
async function writeWeekSummary(
  admin: SupabaseClient,
  week: string,
  periodEnd: string,
  totals: LeakComputeResult["totals"],
  uploadedBy: string | null
): Promise<void> {
  let del = admin.from("leak_week_summary").delete().eq("week", week);
  del = uploadedBy === null ? del.is("uploaded_by", null) : del.eq("uploaded_by", uploadedBy);
  const { error: delError } = await del;
  if (delError) throw new Error(`Gagal reset leak_week_summary: ${delError.message}`);

  const { error } = await admin.from("leak_week_summary").insert({
    week,
    period_end: periodEnd,
    gmv_affiliate_total: totals.gmvAffiliateTotal,
    gmv_tap: totals.gmvTap,
    gmv_leak_potential: totals.gmvBocor,
    gmv_leak_potential_shop_basis: totals.gmvBocorShopBasis,
    source_format: "platform",
    uploaded_by: uploadedBy,
  });
  if (error) throw new Error(`Gagal menulis leak_week_summary: ${error.message}`);
}

/**
 * bd_leads writer with the M4 engine semantics: new shops are inserted with
 * first_seen_week/status; existing leads only get their metrics refreshed
 * (BizDev-managed status/first_seen_week/source untouched). Machine-generated
 * leads for shops that are ber-deal this week are pruned (manual leads kept).
 */
async function writeBdLeads(
  admin: SupabaseClient,
  week: string,
  shops: BdOpportunityShop[],
  partneredShopIds: string[]
): Promise<{ created: number; updated: number }> {
  const existing = new Set<string>();
  const shopIds = shops.map((s) => s.shopId);
  for (let i = 0; i < shopIds.length; i += 200) {
    const { data, error } = await admin
      .from("bd_leads")
      .select("shop_id")
      .in("shop_id", shopIds.slice(i, i + 200));
    if (error) throw new Error(`Gagal membaca bd_leads: ${error.message}`);
    for (const r of data ?? []) existing.add(String(r.shop_id));
  }

  const newLeads = shops
    .filter((s) => !existing.has(s.shopId))
    .map((s) => ({
      shop_id: s.shopId,
      shop_name: s.shopName,
      frequency: s.creators.length,
      total_gmv: s.gmv,
      priority_score: s.priorityScore,
      first_seen_week: week,
      source: "platform",
      status: "baru",
    }));
  for (let i = 0; i < newLeads.length; i += 500) {
    const { error } = await admin.from("bd_leads").insert(newLeads.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis bd_leads baru: ${error.message}`);
  }

  const updatedLeads = shops
    .filter((s) => existing.has(s.shopId))
    .map((s) => ({
      shop_id: s.shopId,
      shop_name: s.shopName,
      frequency: s.creators.length,
      total_gmv: s.gmv,
      priority_score: s.priorityScore,
    }));
  for (let i = 0; i < updatedLeads.length; i += 500) {
    const { error } = await admin
      .from("bd_leads")
      .upsert(updatedLeads.slice(i, i + 500), { onConflict: "shop_id" });
    if (error) throw new Error(`Gagal update bd_leads: ${error.message}`);
  }

  // Stale machine-generated leads: shop became ber-deal (master refreshed or TAP
  // GMV appeared) → it must not linger in the BD pipeline. manual_cm leads stay.
  for (let i = 0; i < partneredShopIds.length; i += 200) {
    const { error } = await admin
      .from("bd_leads")
      .delete()
      .in("source", ["auto_m4", "artifact", "platform"])
      .in("shop_id", partneredShopIds.slice(i, i + 200));
    if (error) throw new Error(`Gagal membersihkan lead usang: ${error.message}`);
  }

  return { created: newLeads.length, updated: updatedLeads.length };
}

/**
 * Platform-data alerts (CLAUDE.md #2: data platform yang merugikan → ALERT, bukan
 * approval). Idempotent per week and SCOPED so a second CM's run for the same week
 * never erases the first one's alerts:
 *   - link_bocor    → scoped to this run's creator ids
 *   - deal_expired  → scoped to this run's shop ids
 *   - deal_expiring → master-wide (identical for every CM), regenerated wholesale
 */
async function writeAlerts(
  admin: SupabaseClient,
  week: string,
  expiryDays: number,
  creators: Array<CreatorLeakRollup & { creatorId: string }>,
  expiredShops: LeakComputeResult["expiredShops"],
  dbShops: CooperatingShopRow[]
): Promise<{ bocor: number; dealExpiring: number; dealExpired: number }> {
  const bocorRows = creators.filter(
    (c) => c.linkStatus === "bocor_sebagian" || c.linkStatus === "bocor_total"
  );
  const creatorIds = creators.map((c) => c.creatorId);
  for (let i = 0; i < creatorIds.length; i += 200) {
    const { error } = await admin
      .from("platform_alerts")
      .delete()
      .eq("week", week)
      .eq("alert_type", "link_bocor")
      .in("entity_id", creatorIds.slice(i, i + 200));
    if (error) throw new Error(`Gagal reset alert link_bocor: ${error.message}`);
  }
  const expiredIds = expiredShops.map((s) => s.shopId);
  for (let i = 0; i < expiredIds.length; i += 200) {
    const { error } = await admin
      .from("platform_alerts")
      .delete()
      .eq("week", week)
      .eq("alert_type", "deal_expired")
      .in("entity_id", expiredIds.slice(i, i + 200));
    if (error) throw new Error(`Gagal reset alert deal_expired: ${error.message}`);
  }
  const { error: delExpiring } = await admin
    .from("platform_alerts")
    .delete()
    .eq("week", week)
    .eq("alert_type", "deal_expiring");
  if (delExpiring) throw new Error(`Gagal reset alert deal_expiring: ${delExpiring.message}`);

  const soonLimit = new Date(new Date(`${week}T00:00:00Z`).getTime() + expiryDays * 86400000)
    .toISOString()
    .slice(0, 10);
  const expiring = dbShops.filter(
    (s) => s.deal_end && s.deal_end >= week && s.deal_end <= soonLimit
  );

  const rows = [
    ...bocorRows.map((c) => ({
      alert_type: "link_bocor",
      entity_type: "creators",
      entity_id: c.creatorId,
      week,
      message: `Creator ${c.creatorName} ${
        c.linkStatus === "bocor_total" ? "BOCOR TOTAL" : "bocor sebagian"
      } (rasio ${((c.leakRatio ?? 0) * 100).toFixed(1)}%, Rp${Math.round(
        c.gmvBocor
      ).toLocaleString("id-ID")}) — follow-up CPM`,
      payload: { ratio: c.leakRatio, status: c.linkStatus, gmv_bocor: c.gmvBocor },
    })),
    ...expiring.map((s) => ({
      alert_type: "deal_expiring",
      entity_type: "cooperating_shops",
      entity_id: String(s.shop_id),
      week,
      message: `Deal shop ${s.shop_name ?? s.shop_id} berakhir ${s.deal_end} (H-${expiryDays}) — perpanjang sebelum habis`,
      payload: { deal_id: s.deal_id, deal_end: s.deal_end },
    })),
    ...expiredShops.map((s) => ({
      alert_type: "deal_expired",
      entity_type: "cooperating_shops",
      entity_id: s.shopId,
      week,
      message: `Deal shop ${s.shopName ?? s.shopId} SUDAH lewat ${
        s.dealEnd ?? "-"
      } tapi masih ada transaksi minggu ini (Rp${Math.round(s.gmv).toLocaleString(
        "id-ID"
      )}) — kebocoran tersembunyi, prioritas re-deal`,
      payload: { deal_id: s.dealId, deal_end: s.dealEnd, gmv: s.gmv },
    })),
  ];

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("platform_alerts").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis platform_alerts: ${error.message}`);
  }
  for (const a of rows) {
    await writeAudit({
      actorId: null, // platform-data event, not a human action
      action: `m4.${a.alert_type}`,
      entityType: a.entity_type,
      entityId: a.entity_id,
      after: a.payload,
      type: "platform_alert",
    });
  }

  return { bocor: bocorRows.length, dealExpiring: expiring.length, dealExpired: expiredShops.length };
}

/**
 * Runs the weekly leak analysis from ALREADY-PARSED rows (used by /ingest Lane 1,
 * which has just parsed the same two files for the performance aggregates).
 * Throws with a user-facing Indonesian message on any rejection; callers wrap it
 * in a discriminated-union server action (Next.js censors thrown messages).
 */
export async function runLeakAnalysis(input: RunLeakAnalysisInput): Promise<LeakAnalysisResult> {
  const { mcnRows, tapRows, masterFile, periodStart, periodEnd, actorId, origin } = input;
  const admin = createAdminClient();
  const skipped: SkippedRow[] = [...(input.skipped ?? [])];

  if (mcnRows.length === 0) {
    throw new Error("File MCN tidak berisi baris data yang valid — analisa bocor dibatalkan.");
  }
  if (tapRows.length === 0) {
    throw new Error(
      "File TAP (via agency link) wajib untuk analisa kebocoran: tanpa TAP, seluruh GMV di shop " +
        "ber-deal akan terlihat 100% bocor. Upload file TAP periode yang sama."
    );
  }

  // W1-W5 gate (reject before any write) — sama seperti jalur artifak.
  const scheme = validateW1W5Period(periodStart, periodEnd);
  if (!scheme.valid) {
    throw new Error(
      `${scheme.reason ?? "Periode file tidak sesuai skema W1-W5."} ` +
        "Export ulang file MCN & TAP per minggu (W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir bulan)."
    );
  }
  const week = periodStart;

  const [sebagian, total, expiryDays, exportDays] = await Promise.all([
    getConfig<number>("m4.bocor_sebagian"),
    getConfig<number>("m4.bocor_total"),
    getConfig<number>("m4.expiry_alert_days"),
    getConfig<number>("retention.leak_export_days"),
  ]);

  const masterInfo = await buildMaster(admin, masterFile);
  const result = computeLeak({
    mcnRows,
    tapRows,
    master: masterInfo.master,
    week,
    thresholds: { sebagian, total },
  });
  const warnings = [...masterInfo.warnings, ...result.warnings];

  // Resolve usernames → creators.id. TIDAK membuat kreator baru (migration 0028):
  // username yang belum terdaftar masuk daftar tunggu dan datanya dilewati.
  const { byName, unresolved } = await resolveCreatorNames(
    admin,
    result.creators.map((c) => c.creatorName)
  );

  const resolved: Array<CreatorLeakRollup & { creatorId: string }> = [];
  for (const c of result.creators) {
    const id = byName.get(c.creatorName.toLowerCase());
    if (!id) {
      skipped.push({ row: -1, reason: pendingSkipReason(c.creatorName, "leak_compute") });
      continue;
    }
    resolved.push({ ...c, creatorId: id });
  }

  const pendingCreators = [...unresolved];
  if (pendingCreators.length > 0) {
    await recordPendingCreators(admin, {
      usernames: pendingCreators,
      source: "leak_compute",
      platform: "tiktok",
      actorId: actorId || null,
    });
  }

  await writeComputedRollups(admin, week, resolved);
  await writeWeekSummary(admin, week, periodEnd, result.totals, actorId || null);
  const bd = await writeBdLeads(admin, week, result.bdShops, result.partneredShopIds);
  const alerts = await writeAlerts(
    admin, week, expiryDays, resolved, result.expiredShops, masterInfo.dbShops
  );
  await enforceLeakRetention(admin, week);

  // CSV backup (per-product detail is intentionally not persisted in Postgres).
  const exportRun = actorId
    ? await writeLeakExports(admin, actorId, week, {
        creators: result.creators,
        detail: result.detail,
        bdShops: result.bdShops,
      })
    : { files: [] as LeakExportFile[], warnings: ["Backup CSV dilewati (tidak ada identitas pengunggah)."] };
  warnings.push(...exportRun.warnings);
  if (actorId) await pruneLeakExports(admin, actorId, exportDays);

  await writeAudit({
    actorId,
    action: "m4.leak_compute",
    entityType: "creator_link_status",
    entityId: week,
    after: {
      origin,
      week,
      period: { start: periodStart, end: periodEnd },
      master_source: masterInfo.source,
      master_shops: masterInfo.count,
      partnered_shops: result.partneredShopIds.length,
      creators_count: resolved.length,
      totals: result.totals,
      bd_leads: bd,
      alerts,
      detail_rows: result.detail.length,
      basis: "product_id+shop_id (official) & shop_id (comparison)",
    },
    type: "auto",
  });

  return {
    week,
    periodStart,
    periodEnd,
    masterSource: masterInfo.source,
    masterShops: masterInfo.count,
    partneredShops: result.partneredShopIds.length,
    creators: resolved.map((c) => ({
      creatorId: c.creatorId,
      creatorName: c.creatorName,
      linkStatus: c.linkStatus,
      leakRatio: c.leakRatio,
      leakRatioShopBasis: c.leakRatioShopBasis,
      gmvBocor: c.gmvBocor,
      gmvBocorShopBasis: c.gmvBocorShopBasis,
      gmvAffiliateTotal: c.gmvAffiliateTotal,
      gmvTap: c.gmvTap,
      gmvDealTotal: c.gmvDealTotal,
      bdOpportunityGmv: c.bdOpportunityGmv,
      directGmv: c.directGmv,
      effectiveness: c.effectiveness,
    })),
    totals: result.totals,
    bdShopsTop: result.bdShops.slice(0, 10),
    bdLeadsNew: bd.created,
    bdLeadsUpdated: bd.updated,
    detailRows: result.detail.length,
    alerts,
    exports: exportRun.files,
    pendingCreators,
    warnings,
    skipped,
  };
}

export interface RunLeakAnalysisFromFilesInput {
  mcnFile: File;
  tapFile: File;
  masterFile?: File | null;
  actorId: string;
  origin?: LeakAnalysisOrigin;
}

/**
 * Standalone entry point for /link-leakage: parses the weekly MCN + TAP exports
 * (and the optional master shop file) then runs the SAME pipeline as /ingest.
 * Does not touch the performance aggregates — this path only recomputes leak.
 */
export async function runLeakAnalysisFromFiles(
  input: RunLeakAnalysisFromFilesInput
): Promise<LeakAnalysisResult> {
  const mcnParsed = await parseMcnFile(input.mcnFile);
  const tapParsed = await parseTapFile(input.tapFile);
  const period = derivePeriod(mcnParsed.rows);
  if (!period) {
    throw new Error(
      "Kolom Date tidak terbaca di file MCN — pastikan file export platform asli (kolom Date berisi rentang seperti 2026-07-01-2026-07-07)."
    );
  }
  return runLeakAnalysis({
    mcnRows: mcnParsed.rows,
    tapRows: tapParsed.rows,
    masterFile: input.masterFile ?? null,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    actorId: input.actorId,
    origin: input.origin ?? "link_leakage",
    skipped: [...mcnParsed.skipped, ...tapParsed.skipped],
  });
}

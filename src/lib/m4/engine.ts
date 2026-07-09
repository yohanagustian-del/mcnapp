import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { genId } from "@/lib/utils/id";
import {
  allocateAgencyGmv,
  classifyPairStatus,
  leadPriority,
  rollupCreatorStatus,
  shopDealState,
} from "@/lib/m4/classify";
import { buildLeakageProductRows, type ClassifiedPair } from "@/lib/m4/leakage-detail";

/** upload_batch convention: one batch per (file kind, week) → re-upload replaces.
 *  Shared with src/app/(portal)/link-leakage/actions.ts and src/lib/ingest/run.ts —
 *  both write transactions_all/transactions_agency_link under these same keys so
 *  the engine core below can run against either origin. */
export const batchAll = (week: string) => `m4all:${week}`;
export const batchAgency = (week: string) => `m4agency:${week}`;

export interface EngineSummary {
  ok: boolean;
  message: string;
  pairs: number;
  creators: number;
  statusCounts: Record<string, number>;
  leads: number;
  alertsBocor: number;
  dealsExpiring: number;
  dealsExpired: number;
}

interface TxAllRow {
  creator_id: string | null;
  product_id: string | null;
  product_info: string | null;
  shop_id: string | null;
  shop_name: string | null;
  affiliate_gmv: number | null;
}
interface TxAgencyRow {
  product_id: string | null;
  shop_id: string | null;
  affiliate_gmv: number | null;
}
interface ShopRow {
  shop_id: string;
  shop_name: string | null;
  deal_id: string | null;
  deal_end: string | null;
}

/**
 * M4 classification engine core (PRD Module 04 §3.1) — deterministic, batch, 0 LLM.
 * Join CSV-1 vs CSV-2 on (product_id, shop_id); leak = GMV diff; shop deal state
 * from cooperating_shops; pair status → agency_links (service-role write, users
 * read-only); creator rollup → creator_link_status; non-deal shops → bd_leads;
 * bocor + deal-expiry → platform_alerts + audit_logs (type platform_alert).
 *
 * Extracted from the /link-leakage server action (BUILD_PLAN Ingestion & Storage
 * Refactor, Fase 1) so the shared ingest pipeline (src/lib/ingest/run.ts) can
 * invoke the same engine after writing a batch, without duplicating the join/
 * classification logic. Behavior is UNCHANGED from the original inline version —
 * this is a pure extraction (permission check + revalidatePath stay in the
 * server action wrapper, not here).
 *
 * IMPORTANT invariants preserved from the original (do not regress):
 *  (a) shopDealState(shop, asOf, hasAgencyGmv) — a shop with TAP GMV>0 counts as
 *      ber-deal even when absent from the cooperating_shops master.
 *  (b) stale bd_leads pruning: source='auto_m4' leads for shops that became
 *      ber-deal this run are deleted (manual leads untouched).
 *  (c) idempotent per week: agency_links / creator_link_status / platform_alerts
 *      are delete-then-(insert|upsert) for the given week before writing.
 */
export async function runLeakageEngineCore(
  admin: SupabaseClient,
  week: string,
  actorId: string
): Promise<EngineSummary> {
  const [sebagian, total, expiryDays] = await Promise.all([
    getConfig<number>("m4.bocor_sebagian"),
    getConfig<number>("m4.bocor_total"),
    getConfig<number>("m4.expiry_alert_days"),
  ]);
  const thresholds = { sebagian, total };

  const [txAll, txAgency, shops] = await Promise.all([
    fetchAll<TxAllRow>(admin, "transactions_all", "creator_id, product_id, product_info, shop_id, shop_name, affiliate_gmv",
      (q) => q.eq("upload_batch", batchAll(week))),
    fetchAll<TxAgencyRow>(admin, "transactions_agency_link", "product_id, shop_id, affiliate_gmv",
      (q) => q.eq("upload_batch", batchAgency(week))),
    fetchAll<ShopRow>(admin, "cooperating_shops", "shop_id, shop_name, deal_id, deal_end", (q) => q),
  ]);
  if (txAll.length === 0) {
    return {
      ok: false, message: `Tidak ada data CSV-1 untuk minggu ${week} — upload dulu.`,
      pairs: 0, creators: 0, statusCounts: {}, leads: 0, alertsBocor: 0, dealsExpiring: 0, dealsExpired: 0,
    };
  }

  const shopById = new Map(shops.map((s) => [s.shop_id, s]));
  const pairKey = (p: string, s: string) => `${p}|${s}`;

  // CSV-2 aggregate per pair (no creator dimension). A shop appearing in CSV-2
  // with GMV>0 is partnered even if the cooperating-shops master lags behind.
  const agencyByPair = new Map<string, number>();
  const agencyShopIds = new Set<string>();
  for (const t of txAgency) {
    if (!t.product_id || !t.shop_id) continue;
    const k = pairKey(t.product_id, t.shop_id);
    agencyByPair.set(k, (agencyByPair.get(k) ?? 0) + (t.affiliate_gmv ?? 0));
    if ((t.affiliate_gmv ?? 0) > 0) agencyShopIds.add(t.shop_id);
  }

  // CSV-1 aggregates: per pair (all creators) and per creator-pair.
  // Name maps (product_id/shop_id → display name) for the leak-detail table +
  // bd_leads shop_name — CSV-1 (transactions_all) is the authoritative source of
  // both names, kept before drop-raw wipes the raw rows.
  const allByPair = new Map<string, number>();
  const byCreatorPair = new Map<string, { creatorId: string; productId: string; shopId: string; gmv: number }>();
  const leadAgg = new Map<string, { frequency: number; totalGmv: number }>(); // non-deal + expired shops
  const shopNameById = new Map<string, string | null>();
  const productNameById = new Map<string, string | null>();
  for (const t of txAll) {
    if (!t.product_id || !t.shop_id) continue;
    const gmv = t.affiliate_gmv ?? 0;
    const k = pairKey(t.product_id, t.shop_id);
    allByPair.set(k, (allByPair.get(k) ?? 0) + gmv);
    if (!shopNameById.has(t.shop_id)) shopNameById.set(t.shop_id, t.shop_name ?? null);
    if (!productNameById.has(t.product_id)) productNameById.set(t.product_id, t.product_info ?? null);

    const state = shopDealState(shopById.get(t.shop_id), week, agencyShopIds.has(t.shop_id));
    if (state === "active" && t.creator_id) {
      const ck = `${t.creator_id}|${k}`;
      const cur = byCreatorPair.get(ck);
      if (cur) cur.gmv += gmv;
      else byCreatorPair.set(ck, { creatorId: t.creator_id, productId: t.product_id, shopId: t.shop_id, gmv });
    } else if (state !== "active") {
      const cur = leadAgg.get(t.shop_id) ?? { frequency: 0, totalGmv: 0 };
      cur.frequency += 1;
      cur.totalGmv += gmv;
      leadAgg.set(t.shop_id, cur);
    }
  }

  // Pair status + creator rollup accumulation.
  const linkRows: Record<string, unknown>[] = [];
  const rollup = new Map<string, { gmvDeal: number; gmvBocor: number }>();
  const classifiedPairs: ClassifiedPair[] = []; // → leakage_products detail rows
  for (const { creatorId, productId, shopId, gmv } of byCreatorPair.values()) {
    const k = pairKey(productId, shopId);
    const allocated = allocateAgencyGmv(gmv, allByPair.get(k) ?? 0, agencyByPair.get(k) ?? 0);
    const bocor = Math.max(gmv - allocated, 0);
    classifiedPairs.push({ creatorId, productId, shopId, gmvAll: gmv, gmvAgency: allocated });

    linkRows.push({
      id: genId("LNK"),
      creator_id: creatorId,
      shop_id: shopId,
      product_ref: productId,
      platform: "tap",
      link_status: classifyPairStatus(gmv, allocated),
      source_upload_week: week,
    });

    const r = rollup.get(creatorId) ?? { gmvDeal: 0, gmvBocor: 0 };
    r.gmvDeal += gmv;
    r.gmvBocor += bocor;
    rollup.set(creatorId, r);
  }

  // Creators seen this week but with zero active-deal-shop GMV → belum_ada_link.
  for (const t of txAll) {
    if (t.creator_id && !rollup.has(t.creator_id)) {
      rollup.set(t.creator_id, { gmvDeal: 0, gmvBocor: 0 });
    }
  }

  // ===== Writes (all idempotent per week) =====
  const { error: delLinks } = await admin
    .from("agency_links").delete().eq("source_upload_week", week);
  if (delLinks) throw new Error(`Gagal reset agency_links minggu ${week}: ${delLinks.message}`);
  for (let i = 0; i < linkRows.length; i += 500) {
    const { error } = await admin.from("agency_links").insert(linkRows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis agency_links: ${error.message}`);
  }

  // leakage_products (per-product leak DETAIL) — the only place shop/product-level
  // leakage survives drop-raw. Only leaking pairs (gmv_bocor > 0) are kept.
  // Delete-then-insert per week = idempotent re-run; chunk 500.
  const leakRows = buildLeakageProductRows(
    classifiedPairs, week, batchAll(week), shopNameById, productNameById
  );
  const { error: delLeak } = await admin
    .from("leakage_products").delete().eq("week", week);
  if (delLeak) throw new Error(`Gagal reset leakage_products minggu ${week}: ${delLeak.message}`);
  for (let i = 0; i < leakRows.length; i += 500) {
    const { error } = await admin.from("leakage_products").insert(leakRows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis leakage_products: ${error.message}`);
  }

  const statusCounts: Record<string, number> = {};
  const statusRows: Record<string, unknown>[] = [];
  const bocorAlerts: { creatorId: string; ratio: number | null; status: string }[] = [];
  for (const [creatorId, r] of rollup) {
    const { leakRatio, status } = rollupCreatorStatus(r.gmvDeal, r.gmvBocor, thresholds);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    statusRows.push({
      creator_id: creatorId,
      week,
      gmv_deal_total: r.gmvDeal,
      gmv_bocor: r.gmvBocor,
      leak_ratio: leakRatio,
      link_status: status,
      computed_at: new Date().toISOString(),
    });
    if (status === "bocor_sebagian" || status === "bocor_total") {
      bocorAlerts.push({ creatorId, ratio: leakRatio, status });
    }
  }
  for (let i = 0; i < statusRows.length; i += 500) {
    const { error } = await admin
      .from("creator_link_status")
      .upsert(statusRows.slice(i, i + 500), { onConflict: "creator_id,week" });
    if (error) throw new Error(`Gagal menulis creator_link_status: ${error.message}`);
  }

  // bd_leads: insert new shops with first_seen_week; update metrics on existing
  // (first_seen_week & status BizDev tetap).
  const leadShopIds = [...leadAgg.keys()];
  // Chunk the .in() filter: PostgREST encodes it in the URL, and thousands of
  // shop ids (multi-creator weekly upload) overflow the URL limit → 400.
  const existingSet = new Set<string>();
  for (let i = 0; i < leadShopIds.length; i += 200) {
    const chunk = leadShopIds.slice(i, i + 200);
    const rows = await fetchAll<{ shop_id: string }>(
      admin, "bd_leads", "shop_id", (q) => q.in("shop_id", chunk));
    for (const r of rows) existingSet.add(r.shop_id);
  }
  const newLeads = leadShopIds
    .filter((s) => !existingSet.has(s))
    .map((shopId) => {
      const { frequency, totalGmv } = leadAgg.get(shopId)!;
      return {
        shop_id: shopId, shop_name: shopNameById.get(shopId) ?? null,
        frequency, total_gmv: totalGmv,
        priority_score: leadPriority(frequency, totalGmv),
        first_seen_week: week, source: "auto_m4", status: "baru",
      };
    });
  if (newLeads.length) {
    const { error } = await admin.from("bd_leads").insert(newLeads);
    if (error) throw new Error(`Gagal menulis bd_leads: ${error.message}`);
  }
  // Chunked upsert instead of one UPDATE per shop: with ~3.400 existing leads this
  // was thousands of sequential round-trips (~12min weekly ingest, browser timeout).
  // Payload carries the metric columns + shop_name + shop_id so ON CONFLICT DO UPDATE
  // refreshes those (incl. backfilling shop_name for pre-existing leads) but never
  // touches first_seen_week/source/status on the existing row. Every row here is
  // guaranteed to already exist (existingSet filter) so this always hits the update
  // branch of the upsert, never an insert with missing NOT NULL columns.
  const updatedLeads = leadShopIds
    .filter((s) => existingSet.has(s))
    .map((shopId) => {
      const { frequency, totalGmv } = leadAgg.get(shopId)!;
      return {
        shop_id: shopId, shop_name: shopNameById.get(shopId) ?? null,
        frequency, total_gmv: totalGmv,
        priority_score: leadPriority(frequency, totalGmv),
      };
    });
  for (let i = 0; i < updatedLeads.length; i += 500) {
    const { error } = await admin
      .from("bd_leads")
      .upsert(updatedLeads.slice(i, i + 500), { onConflict: "shop_id" });
    if (error) throw new Error(`Gagal update bd_leads: ${error.message}`);
  }

  // Prune stale auto-leads: shops that transacted this week but are now ber-deal
  // (in the master or with agency GMV) must not linger as BD leads from an
  // earlier run made before the master was uploaded. Manually-submitted leads
  // (source != auto_m4) are left untouched.
  const berDealShopIds = [
    ...new Set(txAll.map((t) => t.shop_id).filter((s): s is string => !!s)),
  ].filter((s) => !leadAgg.has(s));
  for (let i = 0; i < berDealShopIds.length; i += 200) {
    const { error } = await admin
      .from("bd_leads")
      .delete()
      .eq("source", "auto_m4")
      .in("shop_id", berDealShopIds.slice(i, i + 200));
    if (error) throw new Error(`Gagal membersihkan lead usang: ${error.message}`);
  }

  // Deal expiry checks (only shops with a known deal_end).
  const weekDate = new Date(`${week}T00:00:00Z`);
  const soonLimit = new Date(weekDate.getTime() + expiryDays * 86400000).toISOString().slice(0, 10);
  const transactedShops = new Set(txAll.map((t) => t.shop_id).filter(Boolean));
  const expiring = shops.filter((s) => s.deal_end && s.deal_end >= week && s.deal_end <= soonLimit);
  const expired = shops.filter((s) => s.deal_end && s.deal_end < week && transactedShops.has(s.shop_id));

  // Alerts: platform data events → platform_alerts (queryable) + audit_logs
  // (type platform_alert). Idempotent: this week's M4 alerts are regenerated.
  await admin.from("platform_alerts").delete().eq("week", week)
    .in("alert_type", ["link_bocor", "deal_expiring", "deal_expired"]);
  const alertRows = [
    ...bocorAlerts.map((a) => ({
      alert_type: "link_bocor", entity_type: "creators", entity_id: a.creatorId, week,
      message: `Creator ${a.creatorId} ${a.status === "bocor_total" ? "BOCOR TOTAL" : "bocor sebagian"} (rasio ${((a.ratio ?? 0) * 100).toFixed(1)}%) — follow-up CPM`,
      payload: { ratio: a.ratio, status: a.status },
    })),
    ...expiring.map((s) => ({
      alert_type: "deal_expiring", entity_type: "cooperating_shops", entity_id: s.shop_id, week,
      message: `Deal shop ${s.shop_name ?? s.shop_id} berakhir ${s.deal_end} (H-${expiryDays}) — perpanjang sebelum habis`,
      payload: { deal_id: s.deal_id, deal_end: s.deal_end },
    })),
    ...expired.map((s) => ({
      alert_type: "deal_expired", entity_type: "cooperating_shops", entity_id: s.shop_id, week,
      message: `Deal shop ${s.shop_name ?? s.shop_id} SUDAH lewat ${s.deal_end} tapi masih ada transaksi minggu ini — kebocoran tersembunyi, prioritas re-deal`,
      payload: { deal_id: s.deal_id, deal_end: s.deal_end },
    })),
  ];
  for (let i = 0; i < alertRows.length; i += 500) {
    const { error } = await admin.from("platform_alerts").insert(alertRows.slice(i, i + 500));
    if (error) throw new Error(`Gagal menulis platform_alerts: ${error.message}`);
  }
  for (const a of alertRows) {
    await writeAudit({
      actorId: null, // engine event, not a human action
      action: `m4.${a.alert_type}`,
      entityType: a.entity_type,
      entityId: a.entity_id,
      after: a.payload,
      type: "platform_alert",
    });
  }

  await writeAudit({
    actorId,
    action: "m4.engine_run",
    entityType: "creator_link_status",
    entityId: week,
    after: {
      week, pairs: linkRows.length, creators: rollup.size, statusCounts,
      leads: leadAgg.size, leak_products: leakRows.length, alerts_bocor: bocorAlerts.length,
      deals_expiring: expiring.length, deals_expired: expired.length,
    },
    type: "auto",
  });

  return {
    ok: true,
    message: `Engine selesai untuk minggu ${week}.`,
    pairs: linkRows.length,
    creators: rollup.size,
    statusCounts,
    leads: leadAgg.size,
    alertsBocor: bocorAlerts.length,
    dealsExpiring: expiring.length,
    dealsExpired: expired.length,
  };
}

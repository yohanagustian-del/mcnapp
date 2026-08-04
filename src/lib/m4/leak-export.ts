import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv } from "@/lib/utils/csv";
import type { BdOpportunityShop, CreatorLeakRollup, LeakDetailRow } from "./leak-compute";

/**
 * CSV backup of a weekly leak analysis (interview decision: rollup saja di DB,
 * TAPI CM tetap harus punya file backup seperti dulu punya Excel artifak).
 *
 * Per-product detail is deliberately NOT persisted in Postgres, so the CSVs are
 * written once, right after the analysis, into a PRIVATE Storage bucket
 * (`leak-exports`) and handed back as short-lived signed URLs. The bucket is
 * pruned by age (app_config retention.leak_export_days) — no unbounded growth,
 * and no raw transaction rows in the database either way.
 *
 * The builders below are pure so they can be unit-tested without Supabase.
 */

export const LEAK_EXPORT_BUCKET = "leak-exports";

/** Signed-URL lifetime (seconds) — long enough to click, short enough not to leak. */
export const LEAK_EXPORT_URL_TTL = 3600;

export type LeakExportKind = "summary" | "detail" | "bd";

const KIND_LABELS: Record<LeakExportKind, string> = {
  summary: "Ringkasan per kreator",
  detail: "Detail produk bocor",
  bd: "Peluang BD (shop non-deal)",
};

/** RFC 4180 field escape (quote + double inner quotes) — same rule as actions.ts. */
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  // BOM so Excel (ID locale) opens UTF-8 names correctly.
  return `﻿${lines.join("\r\n")}`;
}

const money = (n: number | null) => (n === null ? "" : Math.round(n));
const ratio = (n: number | null) => (n === null ? "" : (n * 100).toFixed(1));

/** Per-creator rollup CSV (mirrors the artifact's Executive Summary sheet). */
export function buildSummaryCsv(week: string, creators: CreatorLeakRollup[]): string {
  return toCsv(
    [
      "week", "creator", "gmv_affiliate_total", "gmv_tap", "gmv_deal_total",
      "gmv_bocor_produk", "gmv_bocor_shop_basis", "leak_ratio_persen",
      "leak_ratio_shop_basis_persen", "link_status", "bd_opportunity_gmv",
      "direct_gmv", "efektivitas_link_persen", "shop_ber_deal", "shop_non_deal",
    ],
    creators.map((c) => [
      week, c.creatorName, money(c.gmvAffiliateTotal), money(c.gmvTap), money(c.gmvDealTotal),
      money(c.gmvBocor), money(c.gmvBocorShopBasis), ratio(c.leakRatio),
      ratio(c.leakRatioShopBasis), c.linkStatus, money(c.bdOpportunityGmv),
      money(c.directGmv), ratio(c.effectiveness), c.partneredShops, c.nonPartneredShops,
    ])
  );
}

/**
 * Column order of the detail export. Declared once so the per-creator re-export
 * (filterLeakDetailCsv) emits exactly the columns the full weekly backup has.
 */
export const LEAK_DETAIL_CSV_HEADER = [
  "week", "creator", "shop_id", "shop_name", "product_id", "product_name",
  "level_1_category", "level_2_category", "gmv_all_mcn", "gmv_tap", "gmv_bocor", "link_status",
] as const;

/** Per-(creator, shop, product) leak detail CSV (mirrors Leaked_Products_All). */
export function buildDetailCsv(week: string, detail: LeakDetailRow[]): string {
  return toCsv(
    [...LEAK_DETAIL_CSV_HEADER],
    detail.map((d) => [
      week, d.creatorName, d.shopId, d.shopName, d.productId, d.productName,
      d.level1Category, d.level2Category, money(d.gmvAll), money(d.gmvTap),
      money(d.gmvBocor), d.linkStatus,
    ])
  );
}

/** BD opportunity CSV (mirrors BD_Shop_Summary + the creators driving the GMV). */
export function buildBdCsv(week: string, shops: BdOpportunityShop[]): string {
  return toCsv(
    [
      "week", "shop_id", "shop_name", "level_1_category", "level_2_category",
      "gmv_peluang", "jumlah_creator", "jumlah_produk", "status_deal",
      "priority_score", "creators",
    ],
    shops.map((s) => [
      week, s.shopId, s.shopName, s.level1Category, s.level2Category,
      money(s.gmv), s.creators.length, s.products,
      s.dealState === "expired" ? "deal kadaluarsa" : "belum ada deal",
      money(s.priorityScore), s.creators.join(" | "),
    ])
  );
}

export interface LeakExportFile {
  kind: LeakExportKind;
  label: string;
  filename: string;
  /** Signed URL (LEAK_EXPORT_URL_TTL seconds) or null when signing failed. */
  url: string | null;
  rows: number;
  path: string;
}

/** `${uid}/${week}__${kind}__${stamp}.csv` — flat inside the owner folder so one list() call finds everything. */
function exportPath(uid: string, week: string, kind: LeakExportKind, stamp: string): string {
  return `${uid}/${week}__${kind}__${stamp}.csv`;
}

/** Filesystem-safe timestamp for the object name (UTC, seconds precision). */
function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * Uploads the three CSVs and returns signed download URLs. Best-effort: a failed
 * upload/sign yields url=null plus a warning — the analysis itself (already
 * written to Postgres) must never be rolled back because a backup file failed.
 */
export async function writeLeakExports(
  admin: SupabaseClient,
  uid: string,
  week: string,
  payload: {
    creators: CreatorLeakRollup[];
    detail: LeakDetailRow[];
    bdShops: BdOpportunityShop[];
  }
): Promise<{ files: LeakExportFile[]; warnings: string[] }> {
  const stamp = stampNow();
  const specs: Array<{ kind: LeakExportKind; csv: string; rows: number }> = [
    { kind: "summary", csv: buildSummaryCsv(week, payload.creators), rows: payload.creators.length },
    { kind: "detail", csv: buildDetailCsv(week, payload.detail), rows: payload.detail.length },
    { kind: "bd", csv: buildBdCsv(week, payload.bdShops), rows: payload.bdShops.length },
  ];

  const files: LeakExportFile[] = [];
  const warnings: string[] = [];

  for (const spec of specs) {
    const path = exportPath(uid, week, spec.kind, stamp);
    const filename = path.slice(path.indexOf("/") + 1);
    try {
      const { error } = await admin.storage
        .from(LEAK_EXPORT_BUCKET)
        .upload(path, new Blob([spec.csv], { type: "text/csv;charset=utf-8" }), {
          upsert: true,
          contentType: "text/csv;charset=utf-8",
        });
      if (error) throw new Error(error.message);
      const { data, error: signError } = await admin.storage
        .from(LEAK_EXPORT_BUCKET)
        .createSignedUrl(path, LEAK_EXPORT_URL_TTL);
      if (signError) throw new Error(signError.message);
      files.push({
        kind: spec.kind, label: KIND_LABELS[spec.kind], filename,
        url: data?.signedUrl ?? null, rows: spec.rows, path,
      });
    } catch (e) {
      files.push({
        kind: spec.kind, label: KIND_LABELS[spec.kind], filename,
        url: null, rows: spec.rows, path,
      });
      warnings.push(
        `Backup CSV "${KIND_LABELS[spec.kind]}" gagal disimpan: ${
          e instanceof Error ? e.message : "kesalahan tidak diketahui"
        }. Hasil analisa TETAP tersimpan di platform.`
      );
    }
  }

  return { files, warnings };
}

/**
 * Deletes this user's export objects older than `days`. Best-effort (never throws):
 * a stale backup file is harmless, and cleanup must not fail an analysis run.
 */
export async function pruneLeakExports(
  admin: SupabaseClient,
  uid: string,
  days: number
): Promise<number> {
  try {
    const { data, error } = await admin.storage
      .from(LEAK_EXPORT_BUCKET)
      .list(uid, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data) return 0;
    const cutoff = Date.now() - days * 86400000;
    const stale = data
      .filter((o) => {
        const created = o.created_at ? Date.parse(o.created_at) : NaN;
        return Number.isFinite(created) && created < cutoff;
      })
      .map((o) => `${uid}/${o.name}`);
    if (stale.length === 0) return 0;
    await admin.storage.from(LEAK_EXPORT_BUCKET).remove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}

/**
 * Narrows a stored weekly detail-export CSV down to ONE creator's rows.
 *
 * Per-product leak detail is deliberately absent from Postgres for platform-era
 * weeks (only the weekly backup CSV holds it), so the per-creator "Detail" download
 * in CM Workspace re-slices that backup instead of re-running the analysis. Pure so
 * the matching rule is unit-testable.
 *
 * `aliases` = the creator's name AND username: the `creator` column carries the value
 * exactly as printed in the MCN file, which resolveCreatorNames matches against either
 * one (case-insensitively).
 */
export function filterLeakDetailCsv(
  csvText: string,
  aliases: Array<string | null | undefined>
): { csv: string; rows: number } {
  const wanted = new Set(
    aliases.map((a) => (a ?? "").trim().toLowerCase()).filter((a) => a !== "")
  );
  // Strip the UTF-8 BOM written by toCsv — otherwise the first header parses as "﻿week".
  const { rows } = parseCsv(csvText.replace(/^﻿/, ""));
  const matched = rows.filter((r) => wanted.has((r.creator ?? "").trim().toLowerCase()));
  return {
    csv: toCsv(
      [...LEAK_DETAIL_CSV_HEADER],
      matched.map((r) => LEAK_DETAIL_CSV_HEADER.map((h) => r[h] ?? ""))
    ),
    rows: matched.length,
  };
}

/**
 * Finds the newest weekly detail backup for `week` across ALL uploader folders.
 *
 * The backup lives under the uid of whoever ran the analysis, and any CM may need
 * the detail for a creator in their scope — so the lookup scans folders with the
 * service-role client. Row-level scoping happens in the caller (RBAC + creator scope),
 * not here. Returns null when that week predates the platform-computed era.
 */
export async function findLeakDetailExport(
  admin: SupabaseClient,
  week: string
): Promise<string | null> {
  const { data: folders, error } = await admin.storage
    .from(LEAK_EXPORT_BUCKET)
    .list("", { limit: 200 });
  if (error || !folders) return null;

  let best: { path: string; createdAt: number } | null = null;
  for (const folder of folders) {
    if (!folder.name) continue;
    const { data: objects } = await admin.storage
      .from(LEAK_EXPORT_BUCKET)
      .list(folder.name, { limit: 100, search: `${week}__detail__` });
    for (const o of objects ?? []) {
      if (!o.name.startsWith(`${week}__detail__`)) continue;
      const parsed = o.created_at ? Date.parse(o.created_at) : NaN;
      const createdAt = Number.isFinite(parsed) ? parsed : 0;
      if (!best || createdAt > best.createdAt) best = { path: `${folder.name}/${o.name}`, createdAt };
    }
  }
  return best?.path ?? null;
}

/** Lists this user's export backups (newest first) with fresh signed URLs. */
export async function listLeakExports(
  admin: SupabaseClient,
  uid: string,
  limit = 30
): Promise<Array<{ filename: string; path: string; createdAt: string | null; size: number | null; url: string | null }>> {
  const { data, error } = await admin.storage
    .from(LEAK_EXPORT_BUCKET)
    .list(uid, { limit, sortBy: { column: "created_at", order: "desc" } });
  if (error || !data || data.length === 0) return [];

  const paths = data.map((o) => `${uid}/${o.name}`);
  const { data: signed } = await admin.storage
    .from(LEAK_EXPORT_BUCKET)
    .createSignedUrls(paths, LEAK_EXPORT_URL_TTL);
  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  return data.map((o) => ({
    filename: o.name,
    path: `${uid}/${o.name}`,
    createdAt: o.created_at ?? null,
    size: (o.metadata as { size?: number } | null)?.size ?? null,
    url: urlByPath.get(`${uid}/${o.name}`) ?? null,
  }));
}

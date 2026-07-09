import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { genId } from "@/lib/utils/id";

/**
 * Platform exports vary in header wording ("Product name" vs "Product info",
 * "Level 2 category" vs "Level 2 Categories (Unique)"). Headers are already
 * normalized by parseCsv (lowercase, spaces→underscore); this picks the first
 * non-empty value among the known variants.
 */
export function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Like pick, but matches by header prefix — for long/annotated headers like
 *  "gmv_l30d_(otomatis)" or "alamat_(otomatis_terisi_...)". */
export function pickPrefix(row: Record<string, string>, prefixes: string[]): string {
  for (const prefix of prefixes) {
    for (const [key, v] of Object.entries(row)) {
      if (key.startsWith(prefix) && v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v).trim();
      }
    }
  }
  return "";
}

/**
 * Shared column aliases: English snake_case (legacy templates) + normalized
 * Indonesian headers from real TikTok/TAP exports (semicolon-delimited).
 */
export const COL = {
  date: ["date", "period", "tanggal"],
  // Creator identity across TikTok/TAP export variants (EN + ID, username or
  // display name). Multi-creator files carry one of these per row.
  creator: [
    "creator_name", "creator", "creator_username", "creator_nickname",
    "creator_nick_name", "username", "nickname", "nama_kreator", "nama_creator",
    "username_kreator", "nama_pengguna_kreator", "nama_panggilan_kreator",
    "pengguna_kreator", "kreator",
  ],
  productId: ["product_id", "id_produk"],
  productInfo: ["product_info", "product_name", "info_produk", "nama_produk"],
  shopId: ["shop_id", "id_toko"],
  shopName: ["shop_name", "nama_toko"],
  cat1: ["level_1_category", "level1_category", "kategori_level_1"],
  cat2: ["level_2_category", "level2_category", "kategori_level_2"],
  gmv: ["affiliate_gmv", "gmv_afiliasi"],
  gmvLive: ["affiliate_live_gmv", "gmv_live_afiliasi"],
  gmvVideo: ["affiliate_video_gmv", "gmv_video_afiliasi"],
  orders: ["affiliate_orders", "orders", "pesanan_dari_afiliasi", "pesanan"],
  itemsSold: ["items_sold", "produk_terjual"],
  estPartnerCommission: [
    "estimated_affiliate_partner_commission", "est_partner_commission",
    "perkiraan_komisi_affiliate_partner",
  ],
  actualPartnerCommission: [
    "actual_affiliate_partner_commission", "actual_partner_commission",
    "komisi_aktual_untuk_affiliate_partner",
  ],
  estCreatorCommission: [
    "estimated_creator_commission", "est_creator_commission", "perkiraan_komisi_kreator",
  ],
  actualCreatorCommission: ["actual_creator_commission", "komisi_aktual_untuk_kreator"],
} as const;

/** Cap on distinct creators accepted in a single multi-creator platform upload. */
export const MAX_CREATORS_PER_UPLOAD = 30;

/**
 * Distinct creator names/usernames present in a multi-creator file (order kept),
 * used to make detection observable (report) and to enforce the upload cap.
 */
export function distinctCreatorNames(rows: Record<string, string>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const n = pick(r, [...COL.creator]).trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** Integer counts ("1.234" / "1,234" / "1234") → number, null when unreadable. */
export function parseCount(raw: string): number | null {
  const s = raw.replace(/[.,\s]/g, "");
  return s !== "" && /^\d+$/.test(s) ? Number(s) : null;
}

export interface CreatorResolution {
  /** lowercased creator name → creators.id */
  byName: Map<string, string>;
  /** names for which a new prospect creator was created (flag for review) */
  createdProspects: string[];
}

/**
 * Resolves creator name/username values from a multi-creator file to creators.id.
 * Platform exports carry the USERNAME ("Nama pengguna kreator" — e.g. "vikahere"),
 * legacy templates the display name — both are matched case-insensitively.
 * Unknown values become new creators (status = newStatus) + review flag (CLAUDE.md #7),
 * so no platform row is ever dropped for lack of a master record.
 *
 * @param newStatus status to use for newly-created creators. Callers that ingest
 *   platform performance data (metrics upload) pass "aktif" — a creator appearing
 *   in a platform report is by definition already joined with MEA. Other callers
 *   (link-leakage, deal reports) keep the default "prospek".
 */
export async function resolveCreatorNames(
  admin: SupabaseClient,
  names: string[],
  actorId: string,
  newStatus: "prospek" | "aktif" = "prospek"
): Promise<CreatorResolution> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const byName = new Map<string, string>();
  const createdProspects: string[] = [];
  if (unique.length === 0) return { byName, createdProspects };

  // Case-insensitive match on name OR username (platform exports use username).
  const { data, error } = await admin
    .from("creators")
    .select("id, name, username")
    .limit(5000);
  if (error) throw new Error(`resolveCreatorNames lookup failed: ${error.message}`);
  const lookup = new Map<string, string>();
  for (const c of data ?? []) {
    if (c.username) lookup.set(String(c.username).toLowerCase(), c.id);
    if (c.name) lookup.set(String(c.name).toLowerCase(), c.id);
  }
  for (const n of unique) {
    const id = lookup.get(n.toLowerCase());
    if (id) byName.set(n.toLowerCase(), id);
  }

  for (const name of unique) {
    if (byName.has(name.toLowerCase())) continue;
    const id = genId("CRT");
    const { error: insertError } = await admin
      .from("creators")
      .insert({ id, name, username: name, status: newStatus });
    if (insertError) throw new Error(`gagal membuat creator "${name}": ${insertError.message}`);
    byName.set(name.toLowerCase(), id);
    createdProspects.push(name);
    await writeAudit({
      actorId,
      action: "creator.auto_prospect_from_upload",
      entityType: "creators",
      entityId: id,
      after: { name, username: name, status: newStatus },
      type: "auto",
    });
  }
  return { byName, createdProspects };
}

/** platform_metrics_raw.report_source → creators.platform (CLAUDE.md #2 auto-fill). */
export function platformFromReportSource(reportSource: string): "tiktok" | "shopee" {
  return reportSource.includes("tiktok") ? "tiktok" : "shopee";
}

/**
 * Platform-aware creator resolver (CLAUDE.md #5, Shopee ingest task): matches
 * ONLY within creators whose `platform` column already equals the given
 * platform — a Shopee username is NEVER matched against a TikTok creator that
 * happens to share the same username/display name. This is a separate function
 * from `resolveCreatorNames` (which matches cross-platform by design and is
 * used by the TikTok/deals/leak-artifact callers above) so those existing
 * callers are unaffected.
 *
 * Unknown usernames become new creators with platform=`platform`, status=
 * `newStatus`, username=name (same genId/audit_logs/review-flag convention as
 * resolveCreatorNames above).
 */
export async function resolveCreatorNamesByPlatform(
  admin: SupabaseClient,
  names: string[],
  actorId: string,
  platform: "tiktok" | "shopee",
  newStatus: "prospek" | "aktif" = "prospek"
): Promise<CreatorResolution> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const byName = new Map<string, string>();
  const createdProspects: string[] = [];
  if (unique.length === 0) return { byName, createdProspects };

  // Case-insensitive match on name OR username, SCOPED to this platform only.
  const { data, error } = await admin
    .from("creators")
    .select("id, name, username")
    .eq("platform", platform)
    .limit(5000);
  if (error) throw new Error(`resolveCreatorNamesByPlatform lookup failed: ${error.message}`);
  const lookup = new Map<string, string>();
  for (const c of data ?? []) {
    if (c.username) lookup.set(String(c.username).toLowerCase(), c.id);
    if (c.name) lookup.set(String(c.name).toLowerCase(), c.id);
  }
  for (const n of unique) {
    const id = lookup.get(n.toLowerCase());
    if (id) byName.set(n.toLowerCase(), id);
  }

  for (const name of unique) {
    if (byName.has(name.toLowerCase())) continue;
    const id = genId("CRT");
    const { error: insertError } = await admin
      .from("creators")
      .insert({ id, name, username: name, status: newStatus, platform });
    if (insertError) throw new Error(`gagal membuat creator "${name}": ${insertError.message}`);
    byName.set(name.toLowerCase(), id);
    createdProspects.push(name);
    await writeAudit({
      actorId,
      action: "creator.auto_prospect_from_upload",
      entityType: "creators",
      entityId: id,
      after: { name, username: name, status: newStatus, platform },
      type: "auto",
    });
  }
  return { byName, createdProspects };
}

/**
 * jenis_creator from merged GMV (this batch, falling back to existing row value).
 * live>0 & video>0 → "live & vt"; only live → "live"; only video → "vt";
 * neither → null (caller should leave the existing value untouched in that case).
 */
export function deriveJenisCreator(
  gmvLive: number | null | undefined,
  gmvVideo: number | null | undefined
): "live" | "vt" | "live & vt" | null {
  const hasLive = (gmvLive ?? 0) > 0;
  const hasVideo = (gmvVideo ?? 0) > 0;
  if (hasLive && hasVideo) return "live & vt";
  if (hasLive) return "live";
  if (hasVideo) return "vt";
  return null;
}

/**
 * Sums per-metric values across ALL buckets (e.g. one bucket per day, when a
 * platform custom report has a row-per-day) into a single total per creator.
 * Platform custom reports aggregate rows per (creator, day) — but the master
 * creator record (creators.gmv/gmv_live/gmv_video) must reflect the WHOLE
 * upload batch, not just whichever bucket happens to be iterated last.
 *
 * A metric absent from every bucket for a creator stays absent (not defaulted
 * to 0): downstream logic (auto-fill "only touch what changed") distinguishes
 * "no data for this metric" from "value is zero".
 */
export function sumBatchPerCreator(
  totals: Iterable<{ creatorId: string; metrics: Map<string, number> }>
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const { creatorId, metrics } of totals) {
    if (!result.has(creatorId)) result.set(creatorId, new Map());
    const sums = result.get(creatorId)!;
    for (const [metric, value] of metrics) {
      sums.set(metric, (sums.get(metric) ?? 0) + value);
    }
  }
  return result;
}

/**
 * Min(period_start)/max(period_end) per creator across day buckets (a platform
 * custom report has one bucket per day per creator — see sumBatchPerCreator).
 * Used to derive the ONE creator_period_summary row per creator per batch
 * (Module 0.5 §2.3): period_start = earliest day, period_end = latest day.
 */
export function periodRangeByCreator(
  totals: Iterable<{ creatorId: string; period: string }>
): Map<string, { start: string; end: string }> {
  const result = new Map<string, { start: string; end: string }>();
  for (const { creatorId, period } of totals) {
    const range = result.get(creatorId);
    if (!range) {
      result.set(creatorId, { start: period, end: period });
    } else {
      if (period < range.start) range.start = period;
      if (period > range.end) range.end = period;
    }
  }
  return result;
}

/**
 * Ranks level-2 sub-categories by summed affiliate_gmv per creator (across all
 * batches/periods, so tiktok + shopee uploads combine) → top 3 names per creator.
 * Supabase JS has no GROUP BY, so callers fetch raw (creator_id, sub_category,
 * value) rows and this aggregates + ranks them in JS.
 */
export function rankTopNiches(
  rows: { creator_id: string; sub_category: string; value: number }[]
): Map<string, string[]> {
  const sums = new Map<string, Map<string, number>>(); // creatorId -> subCat -> total
  for (const { creator_id, sub_category, value } of rows) {
    if (!sub_category) continue;
    if (!sums.has(creator_id)) sums.set(creator_id, new Map());
    const perCat = sums.get(creator_id)!;
    perCat.set(sub_category, (perCat.get(sub_category) ?? 0) + value);
  }
  const result = new Map<string, string[]>();
  for (const [creatorId, perCat] of sums) {
    const top = [...perCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat);
    result.set(creatorId, top);
  }
  return result;
}

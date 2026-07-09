/**
 * Product×Creator Matching — TAP product catalog (products_tap). Deterministic
 * ETL only, 0 LLM. Two feeders per user decision (final): (a) master product
 * list upload (this file's uploadProductMasterList, wired to a server action) and
 * (b) derive/enrich automatically from the weekly TAP file already ingested by
 * Module 0.5 (upsertDerivedFromTap — wired into the /ingest orchestrator in
 * src/lib/ingest/run.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { getConfig } from "@/lib/config";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseCommission } from "@/lib/utils/commission";
import { isSummaryRow } from "@/lib/utils/csv";
import { pick } from "@/lib/platform-csv";
import { priceSegmentOf, type PriceBounds } from "@/lib/projection/gmv";
import type { UploadReport } from "@/app/(portal)/tim/actions";

// ---------- header aliases (flexible map per CLAUDE.md #7) ----------

const H = {
  productId: ["product_id", "product_id_"],
  productName: ["product_name", "nama_produk"],
  shopId: ["shop_id"],
  shopName: ["shop_name", "nama_toko"],
  level1: ["level_1_category", "level1_category", "kategori_level_1"],
  level2: ["level_2_category", "level2_category", "kategori_level_2"],
  price: ["price", "harga"],
  commission: ["commission", "komisi"],
};

async function loadPriceBounds(): Promise<PriceBounds> {
  return getConfig<PriceBounds>("segments.price_bounds");
}

/**
 * Parses & upserts a manually-uploaded master product list into products_tap
 * (source='master_upload'). Tolerant per CLAUDE.md #7: Rupiah mixed separators
 * (parseRupiah), dirty commission ("not found"/"error"/"5-7%"/empty → null +
 * needs_review, never crash), "Summary" rows skipped. Header map is flexible
 * (English snake_case + Indonesian labels).
 */
export async function uploadProductMasterList(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("products.upload_master");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  if (rows.length === 0 && errors.length === 0) {
    report.skipped.push({ row: -1, reason: "File kosong atau header tidak dikenali" });
    return report;
  }

  const bounds = await loadPriceBounds();
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;
    if (isSummaryRow(raw)) continue; // platform export artifact (CLAUDE.md #7)

    const productId = pick(raw, H.productId);
    const shopId = pick(raw, H.shopId);
    if (!productId || !shopId) {
      report.skipped.push({ row: rowNum, reason: "product_id / shop_id kosong" });
      continue;
    }

    const price = parseRupiah(pick(raw, H.price));
    const priceSegment = price !== null && price > 0 ? priceSegmentOf(price, bounds) : null;

    const commissionRaw = pick(raw, H.commission);
    const commission = parseCommission(commissionRaw);
    const commissionKotor = commissionRaw !== "" && commission === null;

    const { data: existing } = await admin
      .from("products_tap")
      .select("first_seen")
      .eq("product_id", productId)
      .maybeSingle();

    const { error } = await admin.from("products_tap").upsert(
      {
        product_id: productId,
        product_name: pick(raw, H.productName) || null,
        shop_id: shopId,
        shop_name: pick(raw, H.shopName) || null,
        level1_category: pick(raw, H.level1) || null,
        level2_category: pick(raw, H.level2) || null,
        price,
        price_segment: priceSegment,
        commission_pct: commission ? (commission.min + commission.max) / 2 : null,
        commission_note: commission?.isRange
          ? `range ${commission.min}-${commission.max}%`
          : commissionKotor
            ? commissionRaw
            : null,
        source: "master_upload",
        needs_review: commissionKotor || price === null,
        first_seen: existing?.first_seen ?? today,
        last_seen: today,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "product_id" }
    );

    if (error) {
      report.skipped.push({ row: rowNum, reason: error.message });
      continue;
    }
    report.inserted++;
  }

  await writeAudit({
    actorId: actor.id,
    action: "products_tap.upload_master",
    entityType: "products_tap",
    after: { inserted: report.inserted, skipped: report.skipped.length },
    type: "auto",
  });

  return report;
}

// ---------- derive/enrich from weekly TAP file (orchestrator wiring TODO) ----------

/** One row of the already-parsed weekly TAP file (shape from src/lib/ingest/parse.ts's TAP schema). */
export interface TapProductRow {
  product_id: string;
  product_name: string | null;
  shop_id: string;
  shop_name: string | null;
  level2_category: string | null;
  affiliate_gmv: number | null;
  items_sold: number | null;
}

/**
 * Derived-from-TAP half of the products_tap catalog (user decision: catalog =
 * master upload UNION derive/enrich from weekly TAP). Wired into the ingest
 * orchestrator (src/lib/ingest/run.ts) after the weekly TAP rows are parsed.
 *
 * Bulk / no N+1: existing rows are read in chunked `.in(...)` SELECTs and all
 * upserts are written in chunked bulk upserts, so the number of DB round-trips
 * is proportional to ceil(N/200) + ceil(N/500) — NOT to the product count.
 *
 * Behavior: upserts one products_tap row per TAP product (source='derived_tap'),
 * price estimated as affiliate_gmv/items_sold when items_sold>0 (else left null,
 * needs_review=true). Rows already present with source='master_upload' are
 * NEVER overwritten by this function except for last_seen/first_seen bookkeeping
 * — master data (name/shop/category/price/commission) from a real upload always
 * wins over a TAP-derived estimate.
 */
export async function upsertDerivedFromTap(
  admin: SupabaseClient,
  tapRows: TapProductRow[],
  week: string
): Promise<{ upserted: number; skipped: number; errors: string[] }> {
  const bounds = await loadPriceBounds();
  let upserted = 0;
  let skipped = 0;

  // Dedupe by product_id within this batch (a TAP file can list the same
  // product across multiple days/rows) — sum gmv/items so the price estimate
  // reflects the whole week, not just the last row seen.
  const byProduct = new Map<string, TapProductRow & { gmvSum: number; itemsSum: number }>();
  for (const row of tapRows) {
    if (!row.product_id || !row.shop_id) {
      skipped++;
      continue;
    }
    const acc = byProduct.get(row.product_id);
    if (acc) {
      acc.gmvSum += row.affiliate_gmv ?? 0;
      acc.itemsSum += row.items_sold ?? 0;
    } else {
      byProduct.set(row.product_id, {
        ...row,
        gmvSum: row.affiliate_gmv ?? 0,
        itemsSum: row.items_sold ?? 0,
      });
    }
  }

  // ---- Batch-read existing rows (fixes the old per-product N+1) ----
  // The old code issued 1 SELECT + 1 upsert/update per product (2 sequential
  // round-trips × N products). Instead, fetch every existing row we care about
  // in chunked `.in(...)` SELECTs, then build all upsert rows in-memory and
  // write them in chunked bulk upserts. Query count is now proportional to
  // ceil(N/200) + ceil(N/500), not N.
  const productIds = [...byProduct.keys()];
  const existingById = new Map<
    string,
    { source: string | null; first_seen: string | null; shop_id: string }
  >();
  for (let i = 0; i < productIds.length; i += 200) {
    const chunk = productIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("products_tap")
      .select("product_id, source, first_seen, shop_id")
      .in("product_id", chunk);
    if (error) throw new Error(`Gagal membaca products_tap existing: ${error.message}`);
    for (const r of data ?? []) {
      existingById.set(r.product_id as string, {
        source: (r.source as string | null) ?? null,
        first_seen: (r.first_seen as string | null) ?? null,
        shop_id: r.shop_id as string,
      });
    }
  }

  const now = new Date().toISOString();
  // PostgREST bulk writes require every object in one request to share the SAME
  // key set — a master-refresh row (5 cols) mixed with a derived row (12 cols)
  // in one batch fails the whole request with "All object keys must match", so
  // the two shapes are collected and upserted separately.
  const masterRefreshRows: Record<string, unknown>[] = [];
  const derivedRows: Record<string, unknown>[] = [];
  for (const row of byProduct.values()) {
    const existing = existingById.get(row.product_id);

    // Master upload data (name/shop/category/price/commission) is never
    // clobbered by a derived estimate — only bump last_seen/updated_at so the
    // catalog reflects that the product is still active in the platform. We
    // re-send source='master_upload' and the preserved first_seen so the bulk
    // upsert leaves all master fields untouched (onConflict overwrites only the
    // columns present in the row, so master columns we don't list stay as-is;
    // source is re-asserted to master_upload and never downgraded to derived).
    if (existing?.source === "master_upload") {
      masterRefreshRows.push({
        product_id: row.product_id,
        // shop_id is NOT NULL with no default (0019_products_tap.sql) — PostgREST
        // upsert always validates the INSERT branch's column set even when the row
        // already exists and only the UPDATE branch will actually run, so omitting
        // it here made every master-refresh chunk fail with a constraint violation.
        // Re-sending the existing value is a no-op for the UPDATE branch (verified:
        // does not clobber other master columns) and satisfies the INSERT branch.
        shop_id: existing.shop_id,
        source: "master_upload",
        first_seen: existing.first_seen ?? week,
        last_seen: week,
        updated_at: now,
      });
      continue;
    }

    const priceEstimate = row.itemsSum > 0 ? row.gmvSum / row.itemsSum : null;
    const priceSegment = priceEstimate !== null && priceEstimate > 0 ? priceSegmentOf(priceEstimate, bounds) : null;

    derivedRows.push({
      product_id: row.product_id,
      product_name: row.product_name,
      shop_id: row.shop_id,
      shop_name: row.shop_name,
      level2_category: row.level2_category,
      price: priceEstimate,
      price_segment: priceSegment,
      source: "derived_tap",
      needs_review: priceEstimate === null,
      first_seen: existing?.first_seen ?? week,
      last_seen: week,
      updated_at: now,
    });
  }

  const errors: string[] = [];
  for (const [kind, rows] of [
    ["master_refresh", masterRefreshRows],
    ["derived", derivedRows],
  ] as const) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin.from("products_tap").upsert(chunk, { onConflict: "product_id" });
      if (error) {
        skipped += chunk.length;
        const msg =
          `products_tap upsert (${kind}) gagal untuk ${chunk.length} baris ` +
          `(chunk mulai product_id=${chunk[0]?.product_id}): ${error.message}`;
        // Not swallowed silently: logged with chunk context + surfaced in the
        // return value so the ingest orchestrator (src/lib/ingest/run.ts) can
        // record it in the run's `skipped` list instead of losing it.
        console.error(`[upsertDerivedFromTap] ${msg}`);
        errors.push(msg);
      } else {
        upserted += chunk.length;
      }
    }
  }

  return { upserted, skipped, errors };
}

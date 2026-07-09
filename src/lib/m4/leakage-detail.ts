/**
 * M4 leakage DETAIL row builder — pure, deterministic, 0 LLM (PRD Module 04 §3.1
 * follow-up). Extracted from runLeakageEngineCore so the per-product leak rows
 * that back the /link-leakage detail table + CSV download can be unit-tested
 * without Supabase.
 *
 * Context: the drop-raw ingest pipeline deletes transactions_* after aggregation,
 * so the only place per-(shop, product) leak detail survives is leakage_products,
 * written from these rows (short retention.leak_detail_weeks window). We keep ONLY
 * pairs that actually leaked (gmv_bocor > EPSILON) — via_agency pairs are noise
 * for a leak report and would bloat the table.
 */

import { classifyPairStatus, type LinkStatus } from "./classify";

/** One classified creator-pair (output of the engine's byCreatorPair + allocation). */
export interface ClassifiedPair {
  creatorId: string;
  productId: string;
  shopId: string;
  gmvAll: number; // this creator's GMV for the pair in CSV-1
  gmvAgency: number; // allocated agency-link GMV for the pair (CSV-2)
}

/** Row shape mirroring the leakage_products table (0018_leakage_products.sql). */
export interface LeakageProductRow {
  creator_id: string;
  week: string;
  shop_id: string;
  shop_name: string | null;
  product_id: string;
  product_name: string | null;
  gmv_all: number;
  gmv_agency: number;
  gmv_bocor: number;
  link_status: LinkStatus;
  upload_batch: string;
}

const EPSILON = 1; // sub-rupiah diffs are rounding noise, not leakage (matches classify.ts)

/**
 * Build leakage_products rows for the leaking pairs only. Names are resolved from
 * the CSV-1-derived maps (product_id/shop_id → display name); missing → null.
 */
export function buildLeakageProductRows(
  pairs: Iterable<ClassifiedPair>,
  week: string,
  uploadBatch: string,
  shopNameById: Map<string, string | null>,
  productNameById: Map<string, string | null>
): LeakageProductRow[] {
  const rows: LeakageProductRow[] = [];
  for (const p of pairs) {
    const bocor = Math.max(p.gmvAll - p.gmvAgency, 0);
    if (bocor <= EPSILON) continue; // keep only real leaks
    rows.push({
      creator_id: p.creatorId,
      week,
      shop_id: p.shopId,
      shop_name: shopNameById.get(p.shopId) ?? null,
      product_id: p.productId,
      product_name: productNameById.get(p.productId) ?? null,
      gmv_all: p.gmvAll,
      gmv_agency: p.gmvAgency,
      gmv_bocor: bocor,
      link_status: classifyPairStatus(p.gmvAll, p.gmvAgency),
      upload_batch: uploadBatch,
    });
  }
  return rows;
}

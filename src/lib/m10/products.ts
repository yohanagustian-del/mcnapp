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
import { parseFlexibleDate, parsePeriodRange } from "@/lib/utils/date";
import { pick, parseCount } from "@/lib/platform-csv";
import { priceSegmentOf, type PriceBounds } from "@/lib/projection/gmv";
import type { UploadReport } from "@/app/(portal)/tim/actions";

// ---------- header aliases (flexible map per CLAUDE.md #7) ----------
//
// Superset dari dua export nyata yang dipakai tim + template lama:
//  (a) TikTok Partner Compass → Analytics → Custom report (role TAP, dimensi
//      Product + Shop + Product category). Ini format "metric terbaru": satu baris
//      per (produk × campaign × periode) dengan metrik performa lengkap.
//  (b) TAP → Creator Matchmaking → Manage → room campaign → View detail →
//      Approved → Products → "Export link". Ini format yang dipakai tim sekarang.
//      Header persisnya (14 kolom, urutan apa adanya):
//        Campaign ID | product name | <kosong: kolom gambar produk> | Product ID |
//        Sale price | Shop name | Product effective start time |
//        Product effective end time | Creator commission rate |
//        Affiliate partner commission rate | Creator Shop Ads commission rate |
//        Affiliate partner Shop Ads commission rate | Product link |
//        (Only for checking. Please use the left one.)
//      Catatan bentuk data: TIDAK ada Shop ID (hanya Shop name), tidak ada kategori,
//      dan tidak ada metrik performa — ini daftar produk, bukan laporan GMV. Harga
//      "Rp65.000" (titik = ribuan), tanggal "16/07/2026 00:00:00" (DD/MM/YYYY),
//      komisi "7.00%". Kolom terakhir sengaja TIDAK dipetakan: itu URL pembanding
//      yang oleh platform sendiri ditandai "only for checking" — link yang dipakai
//      adalah "Product link".
//  (c) Template master lama (Product ID, Shop ID, Price, Commission).
// Nama kunci sudah dinormalisasi normalizeHeader() (huruf kecil, spasi → "_").

const H = {
  productId: ["product_id", "product_id_"],
  productName: ["product_name", "nama_produk"],
  shopId: ["shop_id", "seller_id"],
  shopName: ["shop_name", "seller_name", "nama_toko"],
  level1: ["level_1_category", "level1_category", "kategori_level_1"],
  level2: ["level_2_category", "level2_category", "kategori_level_2"],
  // Compass tidak punya kolom harga; "Sale price" datang dari campaign product list.
  price: ["sale_price", "price", "harga"],
  // Rate komisi KREATOR (persen).
  commission: ["creator_commission_rate", "commission", "komisi"],
  partnerCommissionRate: ["affiliate_partner_commission_rate", "partner_commission_rate"],
  // Rate komisi khusus penjualan lewat Shop Ads — nilainya beda dari rate afiliasi
  // biasa, jadi disimpan terpisah (bukan menimpa dua kolom di atas).
  creatorShopAdsCommissionRate: ["creator_shop_ads_commission_rate"],
  partnerShopAdsCommissionRate: ["affiliate_partner_shop_ads_commission_rate"],
  // Konteks campaign & periode
  date: ["date", "periode", "tanggal"],
  campaignId: ["campaign_id"],
  campaignName: ["campaign_name"],
  productLink: ["product_link"],
  effectiveStart: ["product_effective_start_time", "effective_start"],
  effectiveEnd: ["product_effective_end_time", "effective_end"],
  // Metrik GMV
  affiliateGmv: ["affiliate_gmv"],
  affiliateVideoGmv: ["affiliate_video_gmv"],
  affiliateLiveGmv: ["affiliate_live_gmv"],
  settledGmv: ["settled_gmv"],
  gmvRefund: ["gmv_(refund)", "gmv_refund"],
  revenueShowcase: ["revenue_(showcase)", "revenue_showcase"],
  // Volume
  orders: ["orders"],
  itemsSold: ["items_sold"],
  // Kreator
  collaboratedCreators: ["collaborated_creators"],
  creatorsWithPosts: ["creators_with_posts"],
  creatorsWithSales: ["creators_with_sales"],
  // Komisi nominal
  estPartnerCommission: ["estimated_affiliate_partner_commission"],
  actualPartnerCommission: ["actual_affiliate_partner_commission"],
  estCreatorCommission: ["estimated_creator_commission"],
  actualCreatorCommission: ["actual_creator_commission"],
  // Metrik Link / showcase
  linkGmv: ["link_gmv"],
  linkItemsSold: ["link_items_sold"],
  linkOrders: ["link_orders"],
  linkPartnerEstCommission: ["link_partner_est._commission", "link_partner_est_commission"],
  linkCreatorEstCommission: ["link_creator_est._commission", "link_creator_est_commission"],
};

/** Kolom yang membuktikan file ini export produk (salah satu cukup). */
const PRODUCT_HEADERS = [...H.productId, ...H.productName];

/**
 * Harga satuan dari sel yang bisa berupa rentang varian ("Rp151.153-Rp376.184").
 * parseRupiah menolak rentang (ada tanda "-"), jadi rentang dipecah dulu dan
 * diambil titik tengahnya — perkiraan harga satuan yang wajar untuk segmentasi.
 * Nilai tunggal jalan seperti biasa; tidak terparse → null (caller flag review).
 */
export function parsePriceCell(raw: string): number | null {
  const direct = parseRupiah(raw);
  if (direct !== null) return direct;

  const parts = raw
    .replace(/rp\.?/gi, "")
    .split(/\s*[-–~]\s*/)
    .map((p) => parseRupiah(p))
    .filter((v): v is number => v !== null && v > 0);
  if (parts.length < 2) return parts[0] ?? null;
  return (Math.min(...parts) + Math.max(...parts)) / 2;
}

/** "16/07/2026 00:00:00" → "2026-07-16". Bagian jam dibuang sebelum diparse. */
function parseDateCell(raw: string): string | null {
  return parseFlexibleDate(raw.split(/\s+/)[0] ?? "");
}

/** Sel angka bulat (orders / items sold / jumlah kreator). "" → null. */
function num(raw: string): number | null {
  return raw === "" ? null : parseCount(raw);
}

/** Sel nominal Rupiah dari export platform. "" → null, "Rp0" → 0. */
function rp(raw: string): number | null {
  return raw === "" ? null : parseRupiah(raw);
}

/** Akumulator metrik satu produk lintas baris (campaign/periode) dalam satu file. */
interface ProductAccumulator {
  product_id: string;
  product_name: string | null;
  shop_id: string | null;
  shop_name: string | null;
  level1_category: string | null;
  level2_category: string | null;
  price: number | null;
  commissionRaw: string;
  commission_pct: number | null;
  commission_note: string | null;
  partner_commission_pct: number | null;
  creator_shop_ads_commission_pct: number | null;
  partner_shop_ads_commission_pct: number | null;
  product_link: string | null;
  effective_start: string | null;
  effective_end: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaignIds: Set<string>;
  /** GMV campaign yang sedang dipegang sebagai "campaign utama" produk ini. */
  topCampaignGmv: number;
  period_start: string | null;
  period_end: string | null;
  /** Metrik yang DIJUMLAH antar baris (GMV, order, komisi nominal). */
  sums: Record<string, number | null>;
  /** Metrik yang diambil MAX antar baris (jumlah kreator — irisannya tak diketahui). */
  maxes: Record<string, number | null>;
}

const SUM_FIELDS = [
  "affiliate_gmv", "affiliate_video_gmv", "affiliate_live_gmv", "settled_gmv",
  "gmv_refund", "revenue_showcase", "orders", "items_sold",
  "est_partner_commission", "actual_partner_commission",
  "est_creator_commission", "actual_creator_commission",
  "link_gmv", "link_items_sold", "link_orders",
  "link_partner_est_commission", "link_creator_est_commission",
] as const;

const MAX_FIELDS = ["collaborated_creators", "creators_with_posts", "creators_with_sales"] as const;

/** null + null = null (tetap "tidak ada data"); selebihnya dijumlah biasa. */
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

async function loadPriceBounds(): Promise<PriceBounds> {
  return getConfig<PriceBounds>("segments.price_bounds");
}

/**
 * Parses & upserts an uploaded TAP product export into products_tap
 * (source='master_upload').
 *
 * Format yang diterima = superset dari export nyata yang dipakai tim (lihat H di
 * atas), dengan TikTok Partner Compass "Custom report" sebagai acuan metrik
 * terbaru: Affiliate GMV (total/video/live), settled GMV, refund, revenue
 * showcase, orders, items sold, jumlah kreator (collaborated / with posts / with
 * sales), komisi partner & kreator (estimasi vs aktual), serta metrik Link.
 *
 * Dua perubahan penting dibanding versi lama:
 *  1. shop_id TIDAK lagi wajib. Export Compass tidak selalu memuat dimensi Shop;
 *     dulu setiap barisnya ditolak "shop_id kosong" sehingga upload selalu 0 baris.
 *  2. Satu produk bisa muncul di beberapa baris (campaign/periode berbeda). Baris
 *     digabung per product_id: metrik GMV/order/komisi DIJUMLAH, jumlah kreator
 *     diambil MAX (irisan kreator antar campaign tidak diketahui — menjumlah akan
 *     melebih-lebihkan), dan campaign penyumbang GMV terbesar disimpan sebagai
 *     campaign utama produk.
 *
 * Tetap tolerant per CLAUDE.md #7: Rupiah campur titik/koma (parseRupiah), harga
 * rentang varian ("Rp151.153-Rp376.184" → titik tengah), komisi kotor ("not
 * found"/"5-7%"/kosong → null + needs_review, tidak pernah crash), baris "Summary"
 * dilewati. Deterministik penuh — 0 LLM.
 */
export async function uploadProductMasterList(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("products.upload_master");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  // requiredHeaders: export Compass kadang menaruh baris judul di atas header asli.
  const { rows, errors } = await parseSheet(file, PRODUCT_HEADERS);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  if (rows.length === 0) {
    return {
      ...report,
      error:
        "Tidak ada baris produk yang terbaca. Pastikan file adalah export Custom report " +
        "(kolom Product ID / Product name ada) dan sheet pertama berisi datanya.",
    };
  }

  const bounds = await loadPriceBounds();
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // ---- Fase 1: parse + agregasi per product_id (tanpa menyentuh DB) ----
  const byProduct = new Map<string, ProductAccumulator>();
  let summaryRows = 0;

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2; // header = baris 1
    if (isSummaryRow(raw)) {
      summaryRows++;
      continue; // artefak export platform (CLAUDE.md #7)
    }
    if (Object.values(raw).every((v) => String(v ?? "").trim() === "")) continue;

    const productId = pick(raw, H.productId);
    if (!productId) {
      report.skipped.push({ row: rowNum, reason: "Product ID kosong" });
      continue;
    }

    const commissionRaw = pick(raw, H.commission);
    const commission = parseCommission(commissionRaw);
    const commissionKotor = commissionRaw !== "" && commission === null;
    const partnerCommission = parseCommission(pick(raw, H.partnerCommissionRate));
    const creatorShopAds = parseCommission(pick(raw, H.creatorShopAdsCommissionRate));
    const partnerShopAds = parseCommission(pick(raw, H.partnerShopAdsCommissionRate));
    const period = parsePeriodRange(pick(raw, H.date));
    const affiliateGmv = rp(pick(raw, H.affiliateGmv));

    const rowSums: Record<string, number | null> = {
      affiliate_gmv: affiliateGmv,
      affiliate_video_gmv: rp(pick(raw, H.affiliateVideoGmv)),
      affiliate_live_gmv: rp(pick(raw, H.affiliateLiveGmv)),
      settled_gmv: rp(pick(raw, H.settledGmv)),
      gmv_refund: rp(pick(raw, H.gmvRefund)),
      revenue_showcase: rp(pick(raw, H.revenueShowcase)),
      orders: num(pick(raw, H.orders)),
      items_sold: num(pick(raw, H.itemsSold)),
      est_partner_commission: rp(pick(raw, H.estPartnerCommission)),
      actual_partner_commission: rp(pick(raw, H.actualPartnerCommission)),
      est_creator_commission: rp(pick(raw, H.estCreatorCommission)),
      actual_creator_commission: rp(pick(raw, H.actualCreatorCommission)),
      link_gmv: rp(pick(raw, H.linkGmv)),
      link_items_sold: num(pick(raw, H.linkItemsSold)),
      link_orders: num(pick(raw, H.linkOrders)),
      link_partner_est_commission: rp(pick(raw, H.linkPartnerEstCommission)),
      link_creator_est_commission: rp(pick(raw, H.linkCreatorEstCommission)),
    };
    const rowMaxes: Record<string, number | null> = {
      collaborated_creators: num(pick(raw, H.collaboratedCreators)),
      creators_with_posts: num(pick(raw, H.creatorsWithPosts)),
      creators_with_sales: num(pick(raw, H.creatorsWithSales)),
    };

    const campaignId = pick(raw, H.campaignId) || null;
    const existing = byProduct.get(productId);

    if (!existing) {
      byProduct.set(productId, {
        product_id: productId,
        product_name: pick(raw, H.productName) || null,
        shop_id: pick(raw, H.shopId) || null,
        shop_name: pick(raw, H.shopName) || null,
        level1_category: pick(raw, H.level1) || null,
        level2_category: pick(raw, H.level2) || null,
        price: parsePriceCell(pick(raw, H.price)),
        commissionRaw,
        commission_pct: commission ? (commission.min + commission.max) / 2 : null,
        commission_note: commission?.isRange
          ? `range ${commission.min}-${commission.max}%`
          : commissionKotor
            ? commissionRaw
            : null,
        partner_commission_pct: partnerCommission
          ? (partnerCommission.min + partnerCommission.max) / 2
          : null,
        creator_shop_ads_commission_pct: creatorShopAds
          ? (creatorShopAds.min + creatorShopAds.max) / 2
          : null,
        partner_shop_ads_commission_pct: partnerShopAds
          ? (partnerShopAds.min + partnerShopAds.max) / 2
          : null,
        product_link: pick(raw, H.productLink) || null,
        effective_start: parseDateCell(pick(raw, H.effectiveStart)),
        effective_end: parseDateCell(pick(raw, H.effectiveEnd)),
        campaign_id: campaignId,
        campaign_name: pick(raw, H.campaignName) || null,
        campaignIds: new Set(campaignId ? [campaignId] : []),
        topCampaignGmv: affiliateGmv ?? 0,
        period_start: period?.start ?? null,
        period_end: period?.end ?? null,
        sums: rowSums,
        maxes: rowMaxes,
      });
      continue;
    }

    // Baris kedua dst untuk produk yang sama: gabungkan.
    for (const f of SUM_FIELDS) existing.sums[f] = addNullable(existing.sums[f], rowSums[f]);
    for (const f of MAX_FIELDS) existing.maxes[f] = maxNullable(existing.maxes[f], rowMaxes[f]);
    if (campaignId) existing.campaignIds.add(campaignId);
    if ((affiliateGmv ?? 0) > existing.topCampaignGmv) {
      existing.topCampaignGmv = affiliateGmv ?? 0;
      existing.campaign_id = campaignId ?? existing.campaign_id;
      existing.campaign_name = pick(raw, H.campaignName) || existing.campaign_name;
    }
    // Periode = rentang gabungan seluruh baris produk ini.
    if (period) {
      existing.period_start =
        existing.period_start && existing.period_start < period.start ? existing.period_start : period.start;
      existing.period_end =
        existing.period_end && existing.period_end > period.end ? existing.period_end : period.end;
    }
    // Atribut master: baris pertama yang punya nilai yang menang (jangan timpa dengan kosong).
    existing.product_name ??= pick(raw, H.productName) || null;
    existing.shop_id ??= pick(raw, H.shopId) || null;
    existing.shop_name ??= pick(raw, H.shopName) || null;
    existing.level1_category ??= pick(raw, H.level1) || null;
    existing.level2_category ??= pick(raw, H.level2) || null;
    existing.product_link ??= pick(raw, H.productLink) || null;
    existing.price ??= parsePriceCell(pick(raw, H.price));
    if (existing.commission_pct === null && commission) {
      existing.commission_pct = (commission.min + commission.max) / 2;
      existing.commission_note = commission.isRange ? `range ${commission.min}-${commission.max}%` : null;
    }
    if (existing.partner_commission_pct === null && partnerCommission) {
      existing.partner_commission_pct = (partnerCommission.min + partnerCommission.max) / 2;
    }
    if (existing.creator_shop_ads_commission_pct === null && creatorShopAds) {
      existing.creator_shop_ads_commission_pct = (creatorShopAds.min + creatorShopAds.max) / 2;
    }
    if (existing.partner_shop_ads_commission_pct === null && partnerShopAds) {
      existing.partner_shop_ads_commission_pct = (partnerShopAds.min + partnerShopAds.max) / 2;
    }
  }

  if (byProduct.size === 0) {
    return {
      ...report,
      error: "Semua baris dilewati — tidak ada Product ID yang valid di file ini.",
    };
  }

  // ---- Fase 2: baca first_seen yang sudah ada (chunked, bukan N+1) ----
  const productIds = [...byProduct.keys()];
  const existingById = new Map<string, { first_seen: string | null }>();
  for (let i = 0; i < productIds.length; i += 200) {
    const chunk = productIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("products_tap")
      .select("product_id, first_seen")
      .in("product_id", chunk);
    if (error) return { ...report, error: `Gagal membaca katalog produk: ${error.message}` };
    for (const r of data ?? []) {
      existingById.set(r.product_id as string, { first_seen: (r.first_seen as string | null) ?? null });
    }
  }

  // ---- Fase 3: bulk upsert ----
  const now = new Date().toISOString();
  let needsReviewCount = 0;
  const payload = [...byProduct.values()].map((p) => {
    // Harga: kolom harga eksplisit kalau ada, kalau tidak diperkirakan dari
    // GMV/items sold pada file yang sama (deterministik, bukan tebakan model).
    const itemsSold = p.sums.items_sold ?? 0;
    const price =
      p.price ?? (itemsSold > 0 && p.sums.affiliate_gmv ? p.sums.affiliate_gmv / itemsSold : null);
    const commissionKotor = p.commissionRaw !== "" && p.commission_pct === null;
    const needsReview = commissionKotor || price === null;
    if (needsReview) needsReviewCount++;

    return {
      product_id: p.product_id,
      product_name: p.product_name,
      shop_id: p.shop_id,
      shop_name: p.shop_name,
      level1_category: p.level1_category,
      level2_category: p.level2_category,
      price,
      price_segment: price !== null && price > 0 ? priceSegmentOf(price, bounds) : null,
      commission_pct: p.commission_pct,
      commission_note: p.commission_note,
      partner_commission_pct: p.partner_commission_pct,
      creator_shop_ads_commission_pct: p.creator_shop_ads_commission_pct,
      partner_shop_ads_commission_pct: p.partner_shop_ads_commission_pct,
      product_link: p.product_link,
      effective_start: p.effective_start,
      effective_end: p.effective_end,
      campaign_id: p.campaign_id,
      campaign_name: p.campaign_name,
      campaign_count: p.campaignIds.size || null,
      period_start: p.period_start,
      period_end: p.period_end,
      ...Object.fromEntries(SUM_FIELDS.map((f) => [f, p.sums[f]])),
      ...Object.fromEntries(MAX_FIELDS.map((f) => [f, p.maxes[f]])),
      source: "master_upload",
      needs_review: needsReview,
      first_seen: existingById.get(p.product_id)?.first_seen ?? today,
      last_seen: today,
      updated_at: now,
    };
  });

  const failedChunks: string[] = [];
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await admin.from("products_tap").upsert(chunk, { onConflict: "product_id" });
    if (error) {
      failedChunks.push(`${chunk.length} produk (mulai ${chunk[0]?.product_id}): ${error.message}`);
      for (const row of chunk) {
        report.skipped.push({ row: -1, reason: `${row.product_id}: ${error.message}` });
      }
      continue;
    }
    report.inserted += chunk.length;
  }

  const newCount = payload.filter((p) => !existingById.has(p.product_id)).length;
  report.summary = [
    { label: "Baris file terbaca", value: String(rows.length) },
    { label: "Produk unik", value: String(byProduct.size) },
    { label: "Produk baru", value: String(newCount) },
    { label: "Produk diperbarui", value: String(byProduct.size - newCount) },
    { label: "Perlu review", value: String(needsReviewCount) },
    ...(summaryRows > 0 ? [{ label: 'Baris "Summary" dilewati', value: String(summaryRows) }] : []),
  ];
  if (failedChunks.length > 0) {
    report.error = `Sebagian produk gagal disimpan — ${failedChunks.join("; ")}`;
  } else if (needsReviewCount > 0) {
    report.warning = `${needsReviewCount} produk ditandai "perlu review" (harga atau rate komisi tidak terbaca). Perbaiki lewat tombol Edit di tabel.`;
  }

  await writeAudit({
    actorId: actor.id,
    action: "products_tap.upload_master",
    entityType: "products_tap",
    after: {
      rows_read: rows.length,
      products: byProduct.size,
      inserted: report.inserted,
      new: newCount,
      needs_review: needsReviewCount,
      skipped: report.skipped.length,
    },
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

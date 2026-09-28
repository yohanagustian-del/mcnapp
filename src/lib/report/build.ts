/**
 * Report Kreator (M2) v2 — pengambil data + perakit `data_json`.
 *
 * Sumber (satu-satunya, CLAUDE.md #4):
 *  - `creator_period_summary` → KPI periode. DIJUMLAH per minggu, bukan diambil
 *    satu baris terbaru: sebelum ini report bulanan hanya menghitung SATU minggu
 *    dari 4–5 minggu yang ada (bug audit #1).
 *  - `creator_top_products` → peringkat produk, termasuk pecahan live/video,
 *    item, dan CTR/CTOR per produk (kolom baru migrasi 0066).
 *  - `creator_subcat_segment_gmv` → komposisi kategori.
 *  - `project_live_sessions` (+ intervals & products) milik JADWAL LIVE
 *    (`schedule_slot_id is not null`, keputusan user 2026-09-21) → analisa sesi.
 *  - Benchmark peer dibaca dari `creator_period_summary`, bukan
 *    `platform_metrics_raw` yang di produksi 0 baris sejak drop-raw (bug #2).
 *
 * TANPA LLM di seluruh jalur ini. Kalimat report dibuat `rules.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { shapeLive } from "@/lib/m7/report-data";
import { DEFAULT_CONTRACT_ALERT_DAYS, type ContractAlertDays } from "@/lib/creators/contract";
import { todayWib, weekOfMonth } from "@/lib/utils/date";
import { computeDelta, periodBounds, type PeriodType } from "./aggregate";
import {
  sessionTimeline, summarizeLiveSessions, toLiveSession, topSessionProducts,
  type LiveIntervalRowInput, type LiveProductRowInput, type LiveSessionRowInput,
} from "./live-analysis";
import {
  DEFAULT_BENCHMARK, DEFAULT_REPORT_RULES, buildBenchmarkRows, buildDataNotes, buildInsights,
  buildRecommendations, buildSummary, assignProductBadges, pickBenchmark,
  type LiveBenchmarks, type ReportRules,
} from "./rules";
import {
  REPORT_SCHEMA_VERSION,
  type ReportDataV2, type ReportDeltas, type ReportKpi, type ReportLiveDeepDive, type ReportProduct,
} from "./types";

// ---------- Bagian murni (diuji tanpa database) ----------

/** Baris `creator_period_summary` yang dibaca report v2. */
export interface PeriodSummaryRowV2 {
  period_start: string;
  created_at: string;
  gmv_total: number | string | null;
  affiliate_gmv: number | string | null;
  affiliate_live_gmv: number | string | null;
  affiliate_video_gmv: number | string | null;
  direct_gmv: number | string | null;
  orders: number | string | null;
  live_orders: number | string | null;
  video_orders: number | string | null;
  items_sold: number | string | null;
  ctr: number | string | null;
  ctor: number | string | null;
  /** PLAN_MSDPS Paket E (migrasi 0074) — null/absent pada batch lama, dibaca sebagai 0. */
  live_direct_gmv?: number | string | null;
  live_direct_orders?: number | string | null;
  live_items_sold?: number | string | null;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/**
 * Satu baris per `period_start` — yang paling baru menurut `created_at`.
 * Re-upload/koreksi minggu yang sama menghasilkan beberapa baris; yang dihitung
 * hanya yang terakhir (konvensi sama dengan M8 `latestTwoPeriods`).
 */
export function latestPerPeriod(rows: PeriodSummaryRowV2[]): PeriodSummaryRowV2[] {
  const byPeriod = new Map<string, PeriodSummaryRowV2>();
  for (const r of rows) {
    const cur = byPeriod.get(r.period_start);
    if (!cur || r.created_at > cur.created_at) byPeriod.set(r.period_start, r);
  }
  return [...byPeriod.values()].sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
}

/**
 * Menjumlah beberapa minggu jadi satu KPI periode. CTR/CTOR dijumlah berbobot
 * GMV — merata-ratakan persentase mingguan begitu saja akan memberi bobot sama
 * pada minggu sepi dan minggu ramai.
 */
export function sumPeriodSummaries(rows: PeriodSummaryRowV2[]): ReportKpi {
  let gmv = 0, liveGmv = 0, videoGmv = 0, directGmv = 0;
  let orders = 0, liveOrders = 0, videoOrders = 0, items = 0;
  let ctrWeighted = 0, ctorWeighted = 0, ctrWeight = 0, ctorWeight = 0;
  let liveDirectGmv = 0, liveDirectOrders = 0, liveItemsSold = 0;

  for (const r of rows) {
    const affiliate = r.affiliate_gmv === null || r.affiliate_gmv === undefined
      ? num(r.gmv_total)
      : num(r.affiliate_gmv);
    gmv += affiliate;
    liveGmv += num(r.affiliate_live_gmv);
    videoGmv += num(r.affiliate_video_gmv);
    directGmv += num(r.direct_gmv);
    orders += num(r.orders);
    liveOrders += num(r.live_orders);
    videoOrders += num(r.video_orders);
    items += num(r.items_sold);
    const w = affiliate > 0 ? affiliate : 1;
    if (r.ctr !== null && r.ctr !== undefined) { ctrWeighted += num(r.ctr) * w; ctrWeight += w; }
    if (r.ctor !== null && r.ctor !== undefined) { ctorWeighted += num(r.ctor) * w; ctorWeight += w; }
    liveDirectGmv += num(r.live_direct_gmv);
    liveDirectOrders += num(r.live_direct_orders);
    liveItemsSold += num(r.live_items_sold);
  }

  return {
    gmv, live_gmv: liveGmv, video_gmv: videoGmv, direct_gmv: directGmv,
    orders, live_orders: liveOrders, video_orders: videoOrders, items,
    aov: ratio(gmv, orders),
    live_share: ratio(liveGmv, gmv),
    video_share: ratio(videoGmv, gmv),
    ctr: ratio(ctrWeighted, ctrWeight),
    ctor: ratio(ctorWeighted, ctorWeight),
    live_direct_gmv: liveDirectGmv,
    live_direct_orders: liveDirectOrders,
    live_items_sold: liveItemsSold,
    live_direct_share: ratio(liveDirectGmv, liveGmv),
  };
}

/**
 * Tren mingguan GMV live vs video (W1–W5) — proyeksi langsung `currentWeeks`
 * (satu baris terbaru per period_start), tidak dijumlah, supaya tren bulanan
 * terlihat naik/turun per minggu, bukan cuma total.
 */
export function weeklyLiveTrend(
  weeks: PeriodSummaryRowV2[]
): { period_start: string; live_gmv: number; video_gmv: number }[] {
  return weeks.map((w) => ({
    period_start: w.period_start,
    live_gmv: num(w.affiliate_live_gmv),
    video_gmv: num(w.affiliate_video_gmv),
  }));
}

/**
 * Batch lama (sebelum migrasi 0074) punya live_direct_gmv/orders/items = 0 untuk
 * semua minggu. "% beli langsung saat live" tidak bisa dibuat dari itu — report
 * HARUS bilang datanya belum ada, bukan menampilkan 0% (CLAUDE.md #5).
 */
export function liveDirectAvailable(weeks: PeriodSummaryRowV2[]): boolean {
  return weeks.some(
    (w) => num(w.live_direct_gmv) > 0 || num(w.live_direct_orders) > 0 || num(w.live_items_sold) > 0
  );
}

/** Baris `creator_top_products` yang dibaca report v2 (kolom baru = migrasi 0066). */
export interface TopProductRowV2 {
  product_id: string;
  product_info: string | null;
  shop_name: string | null;
  level1_category: string | null;
  level2_category: string | null;
  gmv: number | string | null;
  orders: number | string | null;
  live_gmv: number | string | null;
  video_gmv: number | string | null;
  items_sold: number | string | null;
  live_orders: number | string | null;
  video_orders: number | string | null;
  direct_gmv: number | string | null;
  ctr: number | string | null;
  ctor: number | string | null;
}

/**
 * Menggabung baris produk lintas minggu dalam periode. CTR/CTOR berbobot GMV,
 * dengan aturan bobot minimal yang sama seperti saat ingest supaya produk yang
 * baru diklik (belum laku) tidak kehilangan CTR-nya.
 */
export function aggregateProducts(rows: TopProductRowV2[]): ReportProduct[] {
  interface Acc {
    product_id: string; name: string; shop_name: string | null; category: string | null;
    gmv: number; live_gmv: number; video_gmv: number; orders: number; items: number;
    ctrWeighted: number; ctorWeighted: number; weight: number;
  }
  const byProduct = new Map<string, Acc>();
  for (const r of rows) {
    const acc = byProduct.get(r.product_id) ?? {
      product_id: r.product_id,
      name: r.product_info ?? r.product_id,
      shop_name: r.shop_name ?? null,
      category: r.level2_category ?? r.level1_category ?? null,
      gmv: 0, live_gmv: 0, video_gmv: 0, orders: 0, items: 0,
      ctrWeighted: 0, ctorWeighted: 0, weight: 0,
    };
    if (r.product_info) acc.name = r.product_info;
    if (!acc.shop_name && r.shop_name) acc.shop_name = r.shop_name;
    if (!acc.category) acc.category = r.level2_category ?? r.level1_category ?? null;
    acc.gmv += num(r.gmv);
    acc.live_gmv += num(r.live_gmv);
    acc.video_gmv += num(r.video_gmv);
    acc.orders += num(r.orders);
    acc.items += num(r.items_sold);
    if (r.ctr !== null || r.ctor !== null) {
      const w = num(r.gmv) > 0 ? num(r.gmv) : 1;
      if (r.ctr !== null && r.ctr !== undefined) acc.ctrWeighted += num(r.ctr) * w;
      if (r.ctor !== null && r.ctor !== undefined) acc.ctorWeighted += num(r.ctor) * w;
      acc.weight += w;
    }
    byProduct.set(r.product_id, acc);
  }

  return [...byProduct.values()].map((a) => ({
    product_id: a.product_id,
    name: a.name,
    shop_name: a.shop_name,
    category: a.category,
    gmv: a.gmv,
    live_gmv: a.live_gmv,
    video_gmv: a.video_gmv,
    orders: a.orders,
    items: a.items,
    aov: ratio(a.gmv, a.orders),
    ctr: ratio(a.ctrWeighted, a.weight),
    ctor: ratio(a.ctorWeighted, a.weight),
    badges: [],
  }));
}

/**
 * Batch lama (diunggah sebelum 0066) punya live_gmv/video_gmv = 0 untuk semua
 * produk. Peringkat "produk terbaik untuk live" tidak bisa dibuat dari itu —
 * report HARUS mengatakan datanya belum ada, bukan menampilkan semuanya nol.
 */
export function productSplitAvailable(products: ReportProduct[]): boolean {
  return products.some((p) => p.live_gmv > 0 || p.video_gmv > 0);
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "Minggu 1–7 September 2026" / "September 2026" / "8–28 September 2026 (W2–W4)". */
export function periodLabel(type: PeriodType, start: string, endExclusive: string): string {
  const [ys, ms, ds] = start.split("-").map(Number);
  if (type === "monthly") return `${BULAN[ms - 1] ?? ms} ${ys}`;
  const end = new Date(`${endExclusive}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const de = end.getUTCDate();
  const me = end.getUTCMonth() + 1;
  const ye = end.getUTCFullYear();
  const rentang =
    ms === me && ys === ye
      ? `${ds}–${de} ${BULAN[ms - 1] ?? ms} ${ys}`
      : `${ds} ${BULAN[ms - 1] ?? ms} – ${de} ${BULAN[me - 1] ?? me} ${ye}`;
  if (type === "custom") {
    const w1 = weekOfMonth(new Date(Date.UTC(ys, ms - 1, ds)));
    const w2 = weekOfMonth(new Date(Date.UTC(ye, me - 1, de)));
    return ms === me && ys === ye && w1 !== w2 ? `${rentang} (W${w1}–W${w2})` : `${rentang} (W${w1})`;
  }
  return `Minggu ${rentang}`;
}

/** Peringkat produk: live-first bila pecahannya ada, kalau tidak pakai GMV total. */
export function rankProducts(
  products: ReportProduct[],
  by: "live" | "video" | "total",
  limit: number
): ReportProduct[] {
  const pick = (p: ReportProduct) => (by === "live" ? p.live_gmv : by === "video" ? p.video_gmv : p.gmv);
  return [...products]
    .filter((p) => pick(p) > 0)
    .sort((a, b) => pick(b) - pick(a))
    .slice(0, Math.max(0, limit));
}

// ---------- Pengambilan data ----------

export interface BuildReportInput {
  creatorId: string;
  periodType: PeriodType;
  periodStart: string;
  /** WAJIB untuk periodType='custom' (jendela terakhir yang dipilih user); diabaikan untuk weekly/monthly. */
  periodEnd?: string;
  rules?: ReportRules;
  benchmarks?: LiveBenchmarks;
  /** Ambang "segera habis"/"mendesak" untuk contractAlert (app_config m8.contract_alert_days). */
  alertDays?: ContractAlertDays;
}

interface CreatorRow {
  id: string; name: string; username: string | null; niche: string | null;
  level: number | null; contract_end_date: string | null;
}

const SUMMARY_COLUMNS =
  "period_start, created_at, gmv_total, affiliate_gmv, affiliate_live_gmv, affiliate_video_gmv, direct_gmv, orders, live_orders, video_orders, items_sold, ctr, ctor, live_direct_gmv, live_direct_orders, live_items_sold";
const PRODUCT_COLUMNS =
  "product_id, product_info, shop_name, level1_category, level2_category, gmv, orders, live_gmv, video_gmv, items_sold, live_orders, video_orders, direct_gmv, ctr, ctor";
const LIVE_SESSION_COLUMNS =
  "id, session_date, session_no, brand, start_time, end_time, duration_min, gmv, gmv_trend, orders, items, customers, views, viewers_peak, impressions_live, product_impressions, product_clicks, add_to_cart";

/**
 * Merakit `data_json` report v2 untuk satu kreator & satu periode. Melempar
 * bila kreatornya tidak ada; periode tanpa data mingguan TIDAK dilempar —
 * report nol tetap sah dan justru informasi ("tidak ada penjualan minggu ini").
 * Pemanggil yang memutuskan apakah itu layak disimpan.
 */
export async function buildCreatorReportData(
  supabase: SupabaseClient,
  input: BuildReportInput
): Promise<ReportDataV2> {
  const rules = input.rules ?? DEFAULT_REPORT_RULES;
  const benchmarks = input.benchmarks ?? { default: DEFAULT_BENCHMARK };
  const alertDays = input.alertDays ?? DEFAULT_CONTRACT_ALERT_DAYS;
  const bounds = periodBounds(input.periodType, input.periodStart, input.periodEnd);

  const { data: creatorRow } = await supabase
    .from("creators")
    .select("id, name, username, niche, level, contract_end_date")
    .eq("id", input.creatorId)
    .maybeSingle();
  if (!creatorRow) throw new Error(`Creator ${input.creatorId} tidak ditemukan`);
  const creator = creatorRow as CreatorRow;

  const fetchSummary = (start: string, end: string) =>
    fetchAll<PeriodSummaryRowV2>(supabase, "creator_period_summary", SUMMARY_COLUMNS,
      (q) => q.eq("creator_id", input.creatorId).gte("period_start", start).lt("period_start", end));

  const [currentRows, previousRows, productRows] = await Promise.all([
    fetchSummary(bounds.start, bounds.end),
    fetchSummary(bounds.prevStart, bounds.prevEnd),
    fetchAll<TopProductRowV2>(supabase, "creator_top_products", PRODUCT_COLUMNS,
      (q) => q.eq("creator_id", input.creatorId).gte("period_start", bounds.start).lt("period_start", bounds.end)),
  ]);

  const currentWeeks = latestPerPeriod(currentRows);
  const metrics = sumPeriodSummaries(currentWeeks);
  const previous = sumPeriodSummaries(latestPerPeriod(previousRows));
  const liveDirectOk = liveDirectAvailable(currentWeeks);

  const deltas: ReportDeltas = {
    gmv: computeDelta(metrics.gmv, previous.gmv),
    live_gmv: computeDelta(metrics.live_gmv, previous.live_gmv),
    video_gmv: computeDelta(metrics.video_gmv, previous.video_gmv),
    orders: computeDelta(metrics.orders, previous.orders),
    items: computeDelta(metrics.items, previous.items),
    aov: metrics.aov !== null && previous.aov !== null ? computeDelta(metrics.aov, previous.aov) : null,
  };

  const products = aggregateProducts(productRows);
  const splitAvailable = productSplitAvailable(products);
  const topLive = assignProductBadges(
    rankProducts(products, splitAvailable ? "live" : "total", rules.top_n)
  );
  const topVideo = assignProductBadges(
    splitAvailable ? rankProducts(products, "video", rules.top_n) : []
  );

  // ===== Sesi live milik JADWAL LIVE dalam periode ini =====
  const sessionRows = await fetchAll<LiveSessionRowInput & { schedule_slot_id: number | null }>(
    supabase, "project_live_sessions", `${LIVE_SESSION_COLUMNS}, schedule_slot_id`,
    (q) => q.eq("creator_id", input.creatorId)
      .not("schedule_slot_id", "is", null)
      .in("attribution_status", ["verified", "confirmed_manual"])
      .gte("session_date", bounds.start)
      .lt("session_date", bounds.end)
  );
  const sessions = sessionRows.map(toLiveSession);
  const liveSummary = summarizeLiveSessions(sessions, metrics.live_gmv, rules.top_n);
  const bench = pickBenchmark(benchmarks, creator.niche);
  const trend = weeklyLiveTrend(currentWeeks);
  const live = {
    ...liveSummary,
    benchmarks: buildBenchmarkRows(liveSummary, bench),
    weekly_trend: trend,
    weekly_available: trend.some((t) => t.live_gmv > 0 || t.video_gmv > 0),
    live_direct_available: liveDirectOk,
  };

  // ===== Bedah N sesi terbaik =====
  const deepDiveSessions = liveSummary.top_sessions.slice(0, Math.max(0, rules.deep_dive_sessions));
  const deepDiveIds = deepDiveSessions.map((s) => s.session_id);
  let intervals: LiveIntervalRowInput[] = [];
  let sessionProducts: LiveProductRowInput[] = [];
  if (deepDiveIds.length > 0) {
    const [{ data: intervalRows }, { data: productDetailRows }] = await Promise.all([
      supabase
        .from("project_live_intervals")
        .select("session_id, time, gmv, viewers, likes, comments, shares, new_followers")
        .in("session_id", deepDiveIds)
        .order("session_id").order("time"),
      supabase
        .from("project_live_session_products")
        .select("session_id, product_id, product_name, gmv, items, orders, product_impressions, product_clicks")
        .in("session_id", deepDiveIds),
    ]);
    intervals = (intervalRows ?? []) as LiveIntervalRowInput[];
    sessionProducts = (productDetailRows ?? []) as LiveProductRowInput[];
  }

  const rawById = new Map(sessionRows.map((r) => [r.id, r]));
  const liveDeepDive: ReportLiveDeepDive[] = deepDiveSessions.map((s) => {
    const raw = rawById.get(s.session_id);
    const ownIntervals = intervals.filter((i) => i.session_id === s.session_id);
    const ownProducts = sessionProducts.filter((p) => p.session_id === s.session_id);
    // Catatan deterministik memakai shaper yang SAMA dengan report project/slot
    // (lib/m7/report-data.shapeLive) — bukan rumus kedua untuk kalimat yang sama.
    const shaped = shapeLive(
      raw ? [raw as unknown as Record<string, unknown>] : [],
      ownIntervals as unknown as Record<string, unknown>[],
      ownProducts as unknown as Record<string, unknown>[],
      []
    );
    return {
      session: s,
      benchmarks: buildBenchmarkRows(s, bench),
      timeline: sessionTimeline(ownIntervals),
      top_products: topSessionProducts(ownProducts, 5),
      notes: shaped.notes,
    };
  });

  // ===== Kategori =====
  const subcatRows = await fetchAll<{ level2_category: string; gmv: number | string | null; live_gmv: number | string | null }>(
    supabase, "creator_subcat_segment_gmv", "level2_category, gmv, live_gmv",
    (q) => q.eq("creator_id", input.creatorId).gt("window_end", bounds.start).lte("window_end", bounds.end));
  const byCategory = new Map<string, { gmv: number; liveGmv: number }>();
  for (const r of subcatRows) {
    if (!r.level2_category) continue;
    const acc = byCategory.get(r.level2_category) ?? { gmv: 0, liveGmv: 0 };
    acc.gmv += num(r.gmv);
    acc.liveGmv += num(r.live_gmv);
    byCategory.set(r.level2_category, acc);
  }
  // Batch lama tanpa baris subkategori → turunkan dari produk (sumber yang sama-sama nyata).
  if (byCategory.size === 0) {
    for (const p of products) {
      if (!p.category) continue;
      const acc = byCategory.get(p.category) ?? { gmv: 0, liveGmv: 0 };
      acc.gmv += p.gmv;
      acc.liveGmv += p.live_gmv;
      byCategory.set(p.category, acc);
    }
  }
  const categoryTotal = [...byCategory.values()].reduce((a, b) => a + b.gmv, 0);
  const categories = [...byCategory.entries()]
    .map(([sub_category, acc]) => ({ sub_category, gmv: acc.gmv, live_gmv: acc.liveGmv, share: ratio(acc.gmv, categoryTotal) }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 6);

  // ===== Benchmark peer (anonim) — dari agregat, bukan platform_metrics_raw =====
  const benchmarkPeer = await buildPeerBenchmark(supabase, creator, bounds.start, bounds.end);

  // ===== Kontrak & link leakage (dipermukakan, bukan dihitung ulang) =====
  const today = todayWib();
  const contractAlert =
    creator.contract_end_date && creator.contract_end_date <= addDays(today, alertDays.warning)
      ? { contract_end_date: creator.contract_end_date, expired: creator.contract_end_date < today }
      : null;
  const { data: linkStatus } = await supabase
    .from("creator_link_status")
    .select("week, leak_ratio, link_status")
    .eq("creator_id", input.creatorId)
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();

  const label = periodLabel(input.periodType, bounds.start, bounds.end);
  const rulesInput = {
    metrics, previous, deltas, live, benchmarks: live.benchmarks,
    topLive, topVideo, rules, periodLabel: label, categories, liveDirectAvailable: liveDirectOk,
  };

  return {
    schema_version: REPORT_SCHEMA_VERSION,
    creator: {
      id: creator.id, name: creator.name, username: creator.username ?? null,
      niche: creator.niche, level: creator.level,
    },
    period: {
      type: input.periodType, start: bounds.start, end_exclusive: bounds.end,
      prev_start: bounds.prevStart, weeks_counted: currentWeeks.length, label,
    },
    metrics,
    previous,
    deltas,
    video: {
      gmv: metrics.video_gmv,
      orders: metrics.video_orders,
      share: metrics.video_share,
      aov: ratio(metrics.video_gmv, metrics.video_orders),
      ctr: metrics.ctr,
      ctor: metrics.ctor,
      top_products: topVideo,
    },
    live,
    live_deep_dive: liveDeepDive,
    products: { top_live: topLive, top_video: topVideo, split_unavailable: !splitAvailable },
    categories,
    summary: buildSummary(rulesInput),
    insights: buildInsights(rulesInput),
    recommendations: buildRecommendations(rulesInput),
    data_notes: buildDataNotes({
      liveAvailable: liveSummary.available,
      productSplitAvailable: splitAvailable,
      liveDirectMissing: metrics.live_gmv > 0 && !liveDirectOk,
    }),
    benchmark: benchmarkPeer,
    contract_alert: contractAlert,
    link_leakage: linkStatus ?? null,
    level_position: creator.level
      ? { current_level: creator.level, next_level: Math.min(creator.level + 1, 6) }
      : null,
  };
}

/**
 * Rata-rata GMV peer satu niche pada periode yang sama. Dulu dibaca dari
 * `platform_metrics_raw` yang di produksi sudah 0 baris sejak drop-raw Module
 * 0.5 — benchmark karenanya SELALU null (bug audit #2). Sekarang sumbernya
 * `creator_period_summary`, tabel yang memang diisi tiap upload mingguan.
 */
async function buildPeerBenchmark(
  supabase: SupabaseClient,
  creator: CreatorRow,
  start: string,
  end: string
): Promise<{ niche: string; peers: number; peer_avg_gmv: number } | null> {
  if (!creator.niche) return null;
  const { data: peers } = await supabase
    .from("creators").select("id").eq("niche", creator.niche).neq("id", creator.id).limit(200);
  const peerIds = (peers ?? []).map((p) => p.id as string);
  if (peerIds.length === 0) return null;

  const rows = await fetchAll<{ creator_id: string; period_start: string; created_at: string; affiliate_gmv: number | string | null; gmv_total: number | string | null }>(
    supabase, "creator_period_summary", "creator_id, period_start, created_at, affiliate_gmv, gmv_total",
    (q) => q.in("creator_id", peerIds).gte("period_start", start).lt("period_start", end));

  // Peer juga dijumlah per minggu (bukan satu minggu), memakai aturan
  // "baris terbaru per period_start" yang sama dengan kreator yang direport.
  const byPeer = new Map<string, Map<string, { created_at: string; gmv: number }>>();
  for (const r of rows) {
    const weeks = byPeer.get(r.creator_id) ?? new Map();
    const gmv = r.affiliate_gmv === null || r.affiliate_gmv === undefined ? num(r.gmv_total) : num(r.affiliate_gmv);
    const cur = weeks.get(r.period_start);
    if (!cur || r.created_at > cur.created_at) weeks.set(r.period_start, { created_at: r.created_at, gmv });
    byPeer.set(r.creator_id, weeks);
  }
  if (byPeer.size === 0) return null;
  let total = 0;
  for (const weeks of byPeer.values()) {
    for (const w of weeks.values()) total += w.gmv;
  }
  return { niche: creator.niche, peers: byPeer.size, peer_avg_gmv: total / byPeer.size };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

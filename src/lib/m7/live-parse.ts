/**
 * M7 v2 Special Project — TikTok LIVE Center Product/Trend Stats sheet parser
 * (PRD addendum §9). Reads both sheets via the shared `parseSheet()` util (same
 * header-skip/normalization used everywhere else in the repo — CLAUDE.md #4).
 *
 * GMV is ALWAYS taken from the Product sheet (source of truth for the session,
 * §9/§10.2 V6); Trend Stats is timeline + audience metrics only. Missing columns
 * are reported instead of thrown (CLAUDE.md #7) — the caller decides whether that
 * blocks the upload.
 */
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseCount } from "@/lib/platform-csv";
import { parsePercent } from "@/lib/ingest/schema";

const num = (raw: string | undefined): number => parseCount(raw ?? "") ?? 0;
const money = (raw: string | undefined): number => parseRupiah(raw ?? "") ?? 0;
const pct = (raw: string | undefined): number | null => parsePercent(raw ?? "");

// ---------- Product sheet (session GMV source of truth) ----------

// Only headers this parser actually stores (project_live_sessions/§10.4) are
// checked for "missing" — Payment Rate/CTOR (SKU orders)/Available stock exist in
// the real export but have no column to land in yet, so flagging them absent
// would just be noise (CLAUDE.md #7: report what matters, don't cry wolf).
const PRODUCT_COLUMNS = {
  productId: "product_id",
  productName: "product_name",
  gmv: "attributed_gmv",
  items: "attributed_items_sold",
  customers: "customers",
  aov: "aov",
  orders: "attributed_orders",
  productImpressions: "product_impressions",
  ctr: "ctr",
  addedToCart: "added_to_cart",
  ctor: "ctor",
  watchGpm: "watch_gpm",
  productClicks: "product_clicks",
} as const;

const PRODUCT_REQUIRED = [PRODUCT_COLUMNS.productId, PRODUCT_COLUMNS.gmv];

export interface LiveProductRow {
  productId: string;
  productName: string | null;
  gmv: number;
  items: number;
  customers: number;
  aov: number;
  orders: number;
  productImpressions: number;
  ctr: number | null;
  addedToCart: number;
  ctor: number | null;
  watchGpm: number;
  productClicks: number;
}

export interface LiveProductSheetResult {
  rows: LiveProductRow[];
  missingColumns: string[];
  /** Session totals — this IS the session's GMV/orders/items (§9: file Product wins). */
  totals: {
    gmv: number;
    orders: number;
    items: number;
    customers: number;
    productImpressions: number;
    productClicks: number;
    addedToCart: number;
  };
}

export async function parseLiveProductFile(file: File): Promise<LiveProductSheetResult> {
  const { rows: raw } = await parseSheet(file, PRODUCT_REQUIRED);
  const rawHeaders = raw.length > 0 ? Object.keys(raw[0]) : [];
  const missingColumns = Object.values(PRODUCT_COLUMNS).filter((c) => !rawHeaders.includes(c));

  const rows: LiveProductRow[] = raw.map((r) => ({
    productId: (r[PRODUCT_COLUMNS.productId] ?? "").trim(),
    productName: r[PRODUCT_COLUMNS.productName]?.trim() || null,
    gmv: money(r[PRODUCT_COLUMNS.gmv]),
    items: num(r[PRODUCT_COLUMNS.items]),
    customers: num(r[PRODUCT_COLUMNS.customers]),
    aov: money(r[PRODUCT_COLUMNS.aov]),
    orders: num(r[PRODUCT_COLUMNS.orders]),
    productImpressions: num(r[PRODUCT_COLUMNS.productImpressions]),
    ctr: pct(r[PRODUCT_COLUMNS.ctr]),
    addedToCart: num(r[PRODUCT_COLUMNS.addedToCart]),
    ctor: pct(r[PRODUCT_COLUMNS.ctor]),
    watchGpm: money(r[PRODUCT_COLUMNS.watchGpm]),
    productClicks: num(r[PRODUCT_COLUMNS.productClicks]),
  }));

  const totals = rows.reduce(
    (acc, r) => ({
      gmv: acc.gmv + r.gmv,
      orders: acc.orders + r.orders,
      items: acc.items + r.items,
      customers: acc.customers + r.customers,
      productImpressions: acc.productImpressions + r.productImpressions,
      productClicks: acc.productClicks + r.productClicks,
      addedToCart: acc.addedToCart + r.addedToCart,
    }),
    { gmv: 0, orders: 0, items: 0, customers: 0, productImpressions: 0, productClicks: 0, addedToCart: 0 }
  );

  return { rows, missingColumns, totals };
}

// ---------- Trend Stats sheet (timeline + audience metrics only, NOT GMV source) ----------

const TREND_COLUMNS = {
  time: "time",
  gmv: "attributed_gmv",
  items: "attributed_items_sold",
  customers: "customers",
  orders: "attributed_orders",
  viewers: "viewers",
  views: "views",
  productImpressions: "product_impressions",
  productClicks: "product_clicks",
  newFollowers: "new_followers",
  shares: "shares",
  comments: "comments",
  likes: "likes",
} as const;

const TREND_REQUIRED = [TREND_COLUMNS.time, TREND_COLUMNS.gmv];

export interface LiveIntervalRow {
  /** As printed by the export (e.g. "19:30") — caller resolves it against the session date. */
  time: string;
  gmv: number;
  orders: number;
  items: number;
  customers: number;
  viewers: number;
  views: number;
  productImpressions: number;
  productClicks: number;
  newFollowers: number;
  shares: number;
  comments: number;
  likes: number;
}

export interface LiveTrendSheetResult {
  intervals: LiveIntervalRow[];
  missingColumns: string[];
  /** Trend Stats' own GMV total — compared against the Product total for V6 (§10.2), never authoritative on its own. */
  totals: { gmv: number; viewersPeak: number; views: number };
}

export async function parseLiveTrendFile(file: File): Promise<LiveTrendSheetResult> {
  const { rows: raw } = await parseSheet(file, TREND_REQUIRED);
  const rawHeaders = raw.length > 0 ? Object.keys(raw[0]) : [];
  const missingColumns = Object.values(TREND_COLUMNS).filter((c) => !rawHeaders.includes(c));

  const intervals: LiveIntervalRow[] = raw.map((r) => ({
    time: (r[TREND_COLUMNS.time] ?? "").trim(),
    gmv: money(r[TREND_COLUMNS.gmv]),
    orders: num(r[TREND_COLUMNS.orders]),
    items: num(r[TREND_COLUMNS.items]),
    customers: num(r[TREND_COLUMNS.customers]),
    viewers: num(r[TREND_COLUMNS.viewers]),
    views: num(r[TREND_COLUMNS.views]),
    productImpressions: num(r[TREND_COLUMNS.productImpressions]),
    productClicks: num(r[TREND_COLUMNS.productClicks]),
    newFollowers: num(r[TREND_COLUMNS.newFollowers]),
    shares: num(r[TREND_COLUMNS.shares]),
    comments: num(r[TREND_COLUMNS.comments]),
    likes: num(r[TREND_COLUMNS.likes]),
  }));

  const totals = intervals.reduce(
    (acc, r) => ({
      gmv: acc.gmv + r.gmv,
      viewersPeak: Math.max(acc.viewersPeak, r.viewers),
      views: acc.views + r.views,
    }),
    { gmv: 0, viewersPeak: 0, views: 0 }
  );

  return { intervals, missingColumns, totals };
}

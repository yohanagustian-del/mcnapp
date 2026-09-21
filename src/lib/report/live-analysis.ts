/**
 * Report Kreator (M2) v2 — analisa sesi live, MURNI (tanpa I/O) supaya bisa
 * diuji tanpa database dan dipakai satu definisi saja (CLAUDE.md #4).
 *
 * Sumbernya sesi yang sudah tersimpan lewat engine live (`project_live_sessions`
 * + `project_live_intervals` + `project_live_session_products`). Modul ini TIDAK
 * mengambil ulang apa pun dan tidak menghitung ulang yang sudah dihitung saat
 * upload — ia hanya membentuk rasio turunan (CVR/ERR/GPM/CTR/CTOR, GMV per jam)
 * dan meringkasnya per jam mulai / per sesi.
 */
import type { ReportLive, ReportLiveHourBucket, ReportLiveSession } from "./types";

/** Baris sesi apa adanya dari Postgres (numeric bisa datang sebagai string). */
export interface LiveSessionRowInput {
  id: number;
  session_date: string;
  session_no: number | string;
  brand?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_min?: number | string | null;
  gmv?: number | string | null;
  orders?: number | string | null;
  items?: number | string | null;
  views?: number | string | null;
  viewers_peak?: number | string | null;
  impressions_live?: number | string | null;
  product_impressions?: number | string | null;
  product_clicks?: number | string | null;
}

const n = (v: number | string | null | undefined): number => Number(v ?? 0);
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** "19:30:00" → 19; null bila jamnya tidak diketahui. */
export function startHourOf(startTime: string | null | undefined): number | null {
  if (!startTime) return null;
  const m = /^(\d{1,2}):/.exec(startTime);
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : null;
}

/** Satu baris DB → statistik sesi siap tampil. */
export function toLiveSession(row: LiveSessionRowInput): ReportLiveSession {
  const gmv = n(row.gmv);
  const orders = n(row.orders);
  const views = n(row.views);
  const durationMin = n(row.duration_min);
  const impressions = n(row.product_impressions);
  const clicks = n(row.product_clicks);
  const impressionsLive = row.impressions_live === null || row.impressions_live === undefined
    ? null
    : n(row.impressions_live);

  return {
    session_id: row.id,
    date: row.session_date,
    session_no: Number(row.session_no),
    brand: row.brand ?? null,
    start_time: row.start_time ? row.start_time.slice(0, 5) : null,
    end_time: row.end_time ? row.end_time.slice(0, 5) : null,
    start_hour: startHourOf(row.start_time),
    duration_min: durationMin,
    gmv,
    orders,
    items: n(row.items),
    views,
    viewers_peak: n(row.viewers_peak),
    impressions_live: impressionsLive,
    product_impressions: impressions,
    product_clicks: clicks,
    gmv_per_hour: durationMin > 0 ? gmv / (durationMin / 60) : null,
    cvr: ratio(orders, views),
    err: impressionsLive !== null && impressionsLive > 0 ? views / impressionsLive : null,
    gpm: views > 0 ? (gmv / views) * 1000 : null,
    ctr: ratio(clicks, impressions),
    ctor: ratio(orders, clicks),
  };
}

/**
 * Bucket per jam mulai — menjawab "jam berapa live saya paling menghasilkan".
 * Sesi tanpa jam mulai dilewati (bukan dimasukkan ke jam 0 yang akan menipu).
 */
export function bucketByStartHour(sessions: ReportLiveSession[]): ReportLiveHourBucket[] {
  const byHour = new Map<number, ReportLiveHourBucket>();
  for (const s of sessions) {
    if (s.start_hour === null) continue;
    const cur = byHour.get(s.start_hour) ?? { hour: s.start_hour, sessions: 0, gmv: 0, duration_min: 0, gmv_per_hour: null };
    cur.sessions += 1;
    cur.gmv += s.gmv;
    cur.duration_min += s.duration_min;
    byHour.set(s.start_hour, cur);
  }
  return [...byHour.values()]
    .map((b) => ({ ...b, gmv_per_hour: b.duration_min > 0 ? b.gmv / (b.duration_min / 60) : null }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * Jam mulai terbaik = bucket dengan GMV per jam tertinggi; kalau durasi tidak
 * tercatat sama sekali, jatuh ke GMV total. Butuh minimal satu bucket ber-GMV
 * positif — tanpa penjualan, "jam terbaik" tidak punya arti.
 */
export function bestStartHour(buckets: ReportLiveHourBucket[]): number | null {
  const scored = buckets.filter((b) => b.gmv > 0);
  if (scored.length === 0) return null;
  const sorted = [...scored].sort((a, b) => {
    const av = a.gmv_per_hour ?? a.gmv;
    const bv = b.gmv_per_hour ?? b.gmv;
    if (av !== bv) return bv - av;
    return a.hour - b.hour;
  });
  return sorted[0].hour;
}

/** Sesi terbaik lebih dulu (GMV desc, lalu tanggal & nomor sesi agar stabil). */
export function rankSessions(sessions: ReportLiveSession[], limit: number): ReportLiveSession[] {
  return [...sessions]
    .sort((a, b) => {
      if (b.gmv !== a.gmv) return b.gmv - a.gmv;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.session_no - b.session_no;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Agregat seluruh sesi periode ini. `platformLiveGmv` = GMV live menurut
 * agregat platform; dipakai menghitung cakupan data — berapa bagian GMV live
 * yang file sesinya benar-benar diunggah. Rasio tidak dipaksa ≤ 1: kalau
 * sesinya justru lebih besar, angkanya ditampilkan apa adanya.
 */
export function summarizeLiveSessions(
  sessions: ReportLiveSession[],
  platformLiveGmv: number,
  topSessionCount: number
): Omit<ReportLive, "benchmarks"> {
  const sum = (pick: (s: ReportLiveSession) => number) => sessions.reduce((acc, s) => acc + pick(s), 0);
  const gmv = sum((s) => s.gmv);
  const orders = sum((s) => s.orders);
  const views = sum((s) => s.views);
  const duration = sum((s) => s.duration_min);
  const impressions = sum((s) => s.product_impressions);
  const clicks = sum((s) => s.product_clicks);
  const impressionRows = sessions.filter((s) => s.impressions_live !== null);
  const impressionsLive = impressionRows.reduce((acc, s) => acc + (s.impressions_live ?? 0), 0);
  const buckets = bucketByStartHour(sessions);

  return {
    available: sessions.length > 0,
    sessions: sessions.length,
    days: new Set(sessions.map((s) => s.date)).size,
    duration_total_min: duration,
    duration_avg_min: sessions.length > 0 ? duration / sessions.length : null,
    longest_session_min: sessions.length > 0 ? Math.max(...sessions.map((s) => s.duration_min)) : null,
    gmv,
    orders,
    items: sum((s) => s.items),
    views,
    viewers_peak: sessions.reduce((max, s) => Math.max(max, s.viewers_peak), 0),
    gmv_per_session: sessions.length > 0 ? gmv / sessions.length : null,
    gmv_per_hour: duration > 0 ? gmv / (duration / 60) : null,
    cvr: ratio(orders, views),
    err: impressionRows.length > 0 && impressionsLive > 0 ? views / impressionsLive : null,
    gpm: views > 0 ? (gmv / views) * 1000 : null,
    ctr: ratio(clicks, impressions),
    ctor: ratio(orders, clicks),
    by_start_hour: buckets,
    best_start_hour: bestStartHour(buckets),
    top_sessions: rankSessions(sessions, topSessionCount),
    platform_live_gmv: platformLiveGmv,
    coverage_ratio: platformLiveGmv > 0 ? gmv / platformLiveGmv : null,
  };
}

/** Baris produk satu sesi (project_live_session_products) apa adanya dari DB. */
export interface LiveProductRowInput {
  session_id: number;
  product_id?: string | number | null;
  product_name?: string | null;
  gmv?: number | string | null;
  items?: number | string | null;
  orders?: number | string | null;
  product_impressions?: number | string | null;
  product_clicks?: number | string | null;
}

/**
 * Produk teratas satu sesi, digabung per product_id (satu produk bisa muncul
 * beberapa baris). Diurutkan GMV desc — "apa yang laku", bukan "apa yang dipajang".
 */
export function topSessionProducts(
  rows: LiveProductRowInput[],
  limit: number
): {
  name: string; gmv: number; items: number; orders: number;
  impressions: number; clicks: number; ctr: number | null; ctor: number | null;
}[] {
  const byProduct = new Map<string, { name: string; gmv: number; items: number; orders: number; impressions: number; clicks: number }>();
  for (const r of rows) {
    const key = String(r.product_id ?? r.product_name ?? "—");
    const acc = byProduct.get(key) ?? { name: r.product_name ?? "—", gmv: 0, items: 0, orders: 0, impressions: 0, clicks: 0 };
    if (r.product_name) acc.name = r.product_name;
    acc.gmv += n(r.gmv);
    acc.items += n(r.items);
    acc.orders += n(r.orders);
    acc.impressions += n(r.product_impressions);
    acc.clicks += n(r.product_clicks);
    byProduct.set(key, acc);
  }
  return [...byProduct.values()]
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, Math.max(0, limit))
    .map((p) => ({ ...p, ctr: ratio(p.clicks, p.impressions), ctor: ratio(p.orders, p.clicks) }));
}

/** Baris interval 30 menit apa adanya dari DB. */
export interface LiveIntervalRowInput {
  session_id: number;
  time: string;
  gmv?: number | string | null;
  viewers?: number | string | null;
}

export function sessionTimeline(rows: LiveIntervalRowInput[]): { label: string; gmv: number; viewers: number | null }[] {
  return rows.map((r) => ({
    label: String(r.time),
    gmv: n(r.gmv),
    viewers: r.viewers === null || r.viewers === undefined ? null : n(r.viewers),
  }));
}

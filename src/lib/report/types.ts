/**
 * Report Kreator (M2) versi 2 — kontrak `data_json` + suntingan teks tim.
 *
 * Seluruh report v2 DETERMINISTIK: tidak ada satu pun kalimat di sini yang
 * lahir dari LLM (keputusan user 2026-09-21). Angka berasal dari agregat ingest
 * (`creator_period_summary`, `creator_top_products`, `creator_subcat_segment_gmv`)
 * dan sesi live Jadwal Live; kalimatnya dari aturan di `rules.ts` + ambang di
 * `app_config` (`m2.report_rules`, `m2.live_benchmarks`). `token_used` = 0.
 *
 * Report lama (tanpa `schema_version`) tetap terbaca: halaman report memilih
 * penampil berdasarkan field ini, bukan menimpa data lama.
 */

export const REPORT_SCHEMA_VERSION = 2 as const;

export type ReportPeriodType = "weekly" | "monthly";

/** Nada insight box — menentukan warna, bukan sekadar hiasan. */
export type InsightTone = "good" | "warn" | "bad" | "info";

export interface ReportCreator {
  id: string;
  name: string;
  username: string | null;
  niche: string | null;
  level: number | null;
}

export interface ReportPeriod {
  type: ReportPeriodType;
  start: string;
  /** Eksklusif — sama dengan konvensi periodBounds(). */
  end_exclusive: string;
  prev_start: string;
  /** Jumlah baris mingguan yang benar-benar dijumlah (bug #1: monthly dulu cuma 1). */
  weeks_counted: number;
  label: string;
}

/** KPI utama header report. */
export interface ReportKpi {
  gmv: number;
  live_gmv: number;
  video_gmv: number;
  direct_gmv: number;
  orders: number;
  live_orders: number;
  video_orders: number;
  items: number;
  aov: number | null;
  live_share: number | null;
  video_share: number | null;
  /** CTR/CTOR rata-rata berbobot GMV dari agregat ingest; null bila file tak membawanya. */
  ctr: number | null;
  ctor: number | null;
}

export interface ReportDeltas {
  gmv: number | null;
  live_gmv: number | null;
  video_gmv: number | null;
  orders: number | null;
  items: number | null;
  aov: number | null;
}

/** Satu produk di tabel peringkat (live atau video). */
export interface ReportProduct {
  product_id: string;
  name: string;
  shop_name: string | null;
  category: string | null;
  gmv: number;
  live_gmv: number;
  video_gmv: number;
  orders: number;
  items: number;
  aov: number | null;
  ctr: number | null;
  ctor: number | null;
  /** Badge deterministik ("CTR terbaik", "AOV tertinggi", …) — rules.ts. */
  badges: string[];
}

/** Satu baris perbandingan terhadap benchmark niche (m2.live_benchmarks). */
export interface BenchmarkRow {
  key: string;
  label: string;
  value: number | null;
  benchmark: number;
  /** pct = tampilkan sebagai persen; rupiah = nominal (GPM). */
  unit: "pct" | "rupiah";
  status: "above" | "near" | "below" | "unknown";
}

/** Statistik satu sesi live (live-analysis.ts). */
export interface ReportLiveSession {
  session_id: number;
  date: string;
  session_no: number;
  brand: string | null;
  start_time: string | null;
  end_time: string | null;
  /** Jam mulai dibulatkan ke bawah (bucket "jam mulai terbaik"); null bila tak ada jam. */
  start_hour: number | null;
  duration_min: number;
  gmv: number;
  orders: number;
  items: number;
  views: number;
  viewers_peak: number;
  impressions_live: number | null;
  product_impressions: number;
  product_clicks: number;
  gmv_per_hour: number | null;
  /** orders / views — konversi penonton jadi pembeli. */
  cvr: number | null;
  /** views / impressions_live — engaged room rate (berapa banyak yang mampir dari yang lihat). */
  err: number | null;
  /** GMV per 1000 views. */
  gpm: number | null;
  ctr: number | null;
  ctor: number | null;
}

export interface ReportLiveHourBucket {
  hour: number;
  sessions: number;
  gmv: number;
  duration_min: number;
  gmv_per_hour: number | null;
}

export interface ReportLive {
  /** false = kreator tidak punya sesi live dari Jadwal Live pada periode ini. */
  available: boolean;
  sessions: number;
  days: number;
  duration_total_min: number;
  duration_avg_min: number | null;
  longest_session_min: number | null;
  gmv: number;
  orders: number;
  items: number;
  views: number;
  viewers_peak: number;
  gmv_per_session: number | null;
  gmv_per_hour: number | null;
  cvr: number | null;
  err: number | null;
  gpm: number | null;
  ctr: number | null;
  ctor: number | null;
  by_start_hour: ReportLiveHourBucket[];
  best_start_hour: number | null;
  top_sessions: ReportLiveSession[];
  benchmarks: BenchmarkRow[];
  /**
   * GMV live menurut agregat platform (`creator_period_summary`) — bisa BEDA
   * dari `gmv` di atas, yang hanya menjumlah sesi yang file-nya diunggah.
   * Ditampilkan apa adanya sebagai cakupan data, bukan didiamkan.
   */
  platform_live_gmv: number;
  coverage_ratio: number | null;
}

export interface ReportLiveDeepDive {
  session: ReportLiveSession;
  benchmarks: BenchmarkRow[];
  /** Alur 30 menit dari `project_live_intervals`. */
  timeline: { label: string; gmv: number; viewers: number | null }[];
  top_products: {
    name: string;
    gmv: number;
    items: number;
    orders: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
    ctor: number | null;
  }[];
  /** Catatan deterministik (lib/m7/live-notes.ts) — dipakai ulang, bukan ditulis ulang. */
  notes: string[];
}

export interface InsightBox {
  key: string;
  tone: InsightTone;
  title: string;
  text: string;
}

export interface Recommendation {
  key: string;
  text: string;
}

export interface ReportBenchmarkPeer {
  niche: string;
  peers: number;
  peer_avg_gmv: number;
}

export interface ReportDataV2 {
  schema_version: typeof REPORT_SCHEMA_VERSION;
  creator: ReportCreator;
  period: ReportPeriod;
  metrics: ReportKpi;
  previous: ReportKpi;
  deltas: ReportDeltas;
  video: {
    gmv: number;
    orders: number;
    share: number | null;
    aov: number | null;
    ctr: number | null;
    ctor: number | null;
    top_products: ReportProduct[];
  };
  live: ReportLive;
  live_deep_dive: ReportLiveDeepDive[];
  products: {
    top_live: ReportProduct[];
    top_video: ReportProduct[];
    /** true bila batch periode ini belum membawa kolom live/video per produk (upload sebelum 0066). */
    split_unavailable: boolean;
  };
  categories: { sub_category: string; gmv: number; share: number | null }[];
  summary: string;
  insights: InsightBox[];
  recommendations: Recommendation[];
  /** Keterbatasan data yang JUJUR disebut (durasi per video & AWD tidak ada di export). */
  data_notes: string[];
  benchmark: ReportBenchmarkPeer | null;
  contract_alert: { contract_end_date: string; expired: boolean } | null;
  link_leakage: { week: string; leak_ratio: number | null; link_status: string } | null;
  level_position: { current_level: number; next_level: number } | null;
}

/**
 * Suntingan TEKS oleh tim (kolom `creator_reports.edits_json`, migrasi 0066).
 * Hanya teks: ringkasan eksekutif, judul/isi insight box, dan rekomendasi.
 * Angka tidak pernah bisa disunting — kalau angkanya salah, datanya yang
 * diperbaiki lalu report di-generate ulang.
 *
 * Kunci `insights`/`recommendations` = `key` stabil dari rules.ts, jadi
 * suntingan bertahan saat report di-generate ulang selama aturannya masih
 * menghasilkan bagian yang sama.
 */
export interface ReportEdits {
  summary?: string;
  insights?: Record<string, { title?: string; text?: string }>;
  recommendations?: Record<string, string>;
}

export type ReportEditSection = "summary" | "insight" | "recommendation";

/** Report v2 setelah suntingan tim ditempelkan — bentuk yang dirender. */
export function applyReportEdits(data: ReportDataV2, edits: ReportEdits | null): ReportDataV2 {
  if (!edits) return data;
  return {
    ...data,
    summary: edits.summary ?? data.summary,
    insights: data.insights.map((i) => {
      const e = edits.insights?.[i.key];
      return e ? { ...i, title: e.title ?? i.title, text: e.text ?? i.text } : i;
    }),
    recommendations: data.recommendations.map((r) =>
      edits.recommendations?.[r.key] !== undefined ? { ...r, text: edits.recommendations[r.key] } : r
    ),
  };
}

/** Apakah bagian ini sedang memakai teks suntingan tim (untuk tombol "Kembalikan ke otomatis"). */
export function isEdited(edits: ReportEdits | null, section: ReportEditSection, key?: string): boolean {
  if (!edits) return false;
  if (section === "summary") return typeof edits.summary === "string";
  if (section === "insight") return Boolean(key && edits.insights?.[key]);
  return Boolean(key && edits.recommendations?.[key] !== undefined);
}

/** Type guard: report lama (v1) tidak punya `schema_version`. */
export function isReportV2(data: unknown): data is ReportDataV2 {
  return Boolean(
    data && typeof data === "object" && (data as { schema_version?: number }).schema_version === REPORT_SCHEMA_VERSION
  );
}

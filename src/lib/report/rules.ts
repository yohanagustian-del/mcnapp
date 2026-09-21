/**
 * Report Kreator (M2) v2 — SELURUH kalimat report lahir di sini, dari aturan
 * deterministik + ambang `app_config` (`m2.report_rules`, `m2.live_benchmarks`).
 * Tidak ada LLM di jalur ini (keputusan user 2026-09-21, CLAUDE.md #1) dan tidak
 * ada angka yang tidak berasal dari input — kalimat yang tidak punya datanya
 * TIDAK dibuat, bukan dikarang.
 *
 * Murni (tanpa I/O) supaya bisa diuji langsung dan dipakai server maupun klien.
 */
import type {
  BenchmarkRow, InsightBox, Recommendation, ReportDeltas, ReportKpi, ReportLive, ReportProduct,
} from "./types";

// ---------- Bentuk konfigurasi (app_config) ----------

export interface LiveBenchmarkSet {
  cvr: number;
  err: number;
  gpm: number;
  ctr: number;
  ctor: number;
}

export type LiveBenchmarks = Record<string, LiveBenchmarkSet>;

export interface ReportRules {
  top_n: number;
  live_duration_target_min: number;
  long_session_min: number;
  deep_dive_sessions: number;
  video_share_low: number;
  ctor_gap_ratio: number;
}

export const DEFAULT_REPORT_RULES: ReportRules = {
  top_n: 10,
  live_duration_target_min: 300,
  long_session_min: 240,
  deep_dive_sessions: 2,
  video_share_low: 0.15,
  ctor_gap_ratio: 0.25,
};

export const DEFAULT_BENCHMARK: LiveBenchmarkSet = { cvr: 0.03, err: 0.02, gpm: 3000, ctr: 0.05, ctor: 0.03 };

/**
 * Benchmark untuk niche kreator. Kunci dicocokkan huruf kecil dan cukup
 * TERKANDUNG di nama niche ("Beauty & Personal Care" → `beauty`), karena niche
 * di master kreator ditulis bebas. Tidak ketemu → `default`.
 */
export function pickBenchmark(benchmarks: LiveBenchmarks, niche: string | null): LiveBenchmarkSet {
  const fallback = benchmarks.default ?? DEFAULT_BENCHMARK;
  if (!niche) return fallback;
  const lower = niche.toLowerCase();
  for (const [key, value] of Object.entries(benchmarks)) {
    if (key === "default") continue;
    if (lower.includes(key.toLowerCase())) return value;
  }
  return fallback;
}

/** Ambang "near": masih di bawah benchmark tapi tidak jauh (≥80%). */
const NEAR_RATIO = 0.8;

export function benchmarkStatus(value: number | null, benchmark: number): BenchmarkRow["status"] {
  if (value === null || benchmark <= 0) return "unknown";
  if (value >= benchmark) return "above";
  if (value >= benchmark * NEAR_RATIO) return "near";
  return "below";
}

/** Lima baris perbandingan live vs benchmark niche — urutannya tetap. */
export function buildBenchmarkRows(
  live: { cvr: number | null; err: number | null; gpm: number | null; ctr: number | null; ctor: number | null },
  bench: LiveBenchmarkSet
): BenchmarkRow[] {
  const rows: { key: keyof LiveBenchmarkSet; label: string; value: number | null; unit: BenchmarkRow["unit"] }[] = [
    { key: "cvr", label: "Konversi penonton → order (CVR)", value: live.cvr, unit: "pct" },
    { key: "err", label: "Engaged room rate (ERR)", value: live.err, unit: "pct" },
    { key: "gpm", label: "GPM (GMV per 1.000 views)", value: live.gpm, unit: "rupiah" },
    { key: "ctr", label: "CTR produk", value: live.ctr, unit: "pct" },
    { key: "ctor", label: "CTOR (klik → order)", value: live.ctor, unit: "pct" },
  ];
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: r.value,
    benchmark: bench[r.key],
    unit: r.unit,
    status: benchmarkStatus(r.value, bench[r.key]),
  }));
}

// ---------- Badge produk ----------

/**
 * Badge deterministik per produk: satu pemenang per kriteria, hanya diberikan
 * bila kriterianya punya angka (CTR null tidak pernah menang "CTR terbaik") dan
 * hanya bila kandidatnya lebih dari satu — badge di daftar satu produk tidak
 * memberi informasi apa pun.
 */
export function assignProductBadges(products: ReportProduct[]): ReportProduct[] {
  if (products.length < 2) return products.map((p) => ({ ...p, badges: [] }));

  const winner = (pick: (p: ReportProduct) => number | null): string | null => {
    let best: { id: string; value: number } | null = null;
    for (const p of products) {
      const v = pick(p);
      if (v === null || v <= 0) continue;
      if (!best || v > best.value) best = { id: p.product_id, value: v };
    }
    return best?.id ?? null;
  };

  const badgeByProduct = new Map<string, string[]>();
  const add = (id: string | null, label: string) => {
    if (!id) return;
    badgeByProduct.set(id, [...(badgeByProduct.get(id) ?? []), label]);
  };
  add(winner((p) => p.ctr), "CTR terbaik");
  add(winner((p) => p.ctor), "CTOR champion");
  add(winner((p) => p.aov), "AOV tertinggi");
  add(winner((p) => p.items), "Volume tinggi");

  return products.map((p) => ({ ...p, badges: badgeByProduct.get(p.product_id) ?? [] }));
}

// ---------- Format (dipakai kalimat di bawah) ----------

export const rupiah = (v: number): string => `Rp${Math.round(v).toLocaleString("id-ID")}`;
export const rupiahShort = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `Rp${(v / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (abs >= 1_000_000) return `Rp${(v / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (abs >= 1_000) return `Rp${Math.round(v / 1_000).toLocaleString("id-ID")} rb`;
  return rupiah(v);
};
export const persen = (v: number | null, digits = 1): string =>
  v === null ? "—" : `${(v * 100).toFixed(digits).replace(".", ",")}%`;
export const jam = (minutes: number): string => {
  const h = minutes / 60;
  return `${(Number.isInteger(h) ? h : Number(h.toFixed(1))).toString().replace(".", ",")} jam`;
};

// ---------- Insight & rekomendasi ----------

export interface RulesInput {
  metrics: ReportKpi;
  previous: ReportKpi;
  deltas: ReportDeltas;
  live: Omit<ReportLive, "benchmarks">;
  benchmarks: BenchmarkRow[];
  topLive: ReportProduct[];
  topVideo: ReportProduct[];
  rules: ReportRules;
  periodLabel: string;
}

/**
 * Insight box: setiap kotak lahir dari SATU kondisi yang bisa dibaca ulang di
 * kode ini. Kunci (`key`) stabil supaya suntingan tim (edits_json) menempel ke
 * kotak yang sama walau report di-generate ulang.
 */
export function buildInsights(input: RulesInput): InsightBox[] {
  const { metrics, deltas, live, benchmarks, rules } = input;
  const out: InsightBox[] = [];

  if (deltas.gmv !== null) {
    const naik = deltas.gmv >= 0;
    out.push({
      key: "gmv_trend",
      tone: naik ? "good" : "bad",
      title: naik ? "GMV naik dibanding periode lalu" : "GMV turun dibanding periode lalu",
      text: `GMV ${input.periodLabel} ${rupiahShort(metrics.gmv)} — ${naik ? "naik" : "turun"} ${persen(Math.abs(deltas.gmv))} dari periode sebelumnya (${rupiahShort(input.previous.gmv)} → ${rupiahShort(metrics.gmv)}).`,
    });
  } else if (metrics.gmv > 0) {
    out.push({
      key: "gmv_trend",
      tone: "info",
      title: "Belum ada pembanding periode lalu",
      text: `GMV ${input.periodLabel} ${rupiahShort(metrics.gmv)}. Periode sebelumnya belum punya data, jadi tren belum bisa dihitung.`,
    });
  }

  // Komposisi live vs video — inti keputusan alokasi jam kerja kreator.
  if (metrics.gmv > 0 && metrics.live_share !== null && metrics.video_share !== null) {
    const videoRendah = metrics.video_share < rules.video_share_low;
    out.push({
      key: "channel_mix",
      tone: videoRendah ? "warn" : "info",
      title: videoRendah ? "Hampir semua GMV dari live" : "Komposisi live & video",
      text: `Live menyumbang ${persen(metrics.live_share)} GMV, video ${persen(metrics.video_share)}.` +
        (videoRendah
          ? ` Video di bawah ${persen(rules.video_share_low, 0)} — konten video yang konsisten bisa jadi bantalan saat jam live berkurang.`
          : " Dua kanal sama-sama berjalan."),
    });
  }

  if (live.available) {
    const kurangDurasi = live.duration_avg_min !== null && live.duration_avg_min < rules.live_duration_target_min;
    out.push({
      key: "live_duration",
      tone: kurangDurasi ? "warn" : "good",
      title: kurangDurasi ? "Durasi live masih di bawah target" : "Durasi live sudah sesuai target",
      text: `${live.sessions} sesi, total ${jam(live.duration_total_min)}` +
        (live.duration_avg_min !== null ? `, rata-rata ${jam(live.duration_avg_min)} per sesi` : "") +
        `. Target internal ${jam(rules.live_duration_target_min)} per sesi.` +
        (live.gmv_per_hour !== null ? ` GMV per jam live ${rupiahShort(live.gmv_per_hour)}.` : ""),
    });

    if (live.best_start_hour !== null) {
      out.push({
        key: "live_best_hour",
        tone: "good",
        title: `Jam mulai paling produktif: ${String(live.best_start_hour).padStart(2, "0")}.00`,
        text: `Dari ${live.sessions} sesi periode ini, live yang mulai pukul ${String(live.best_start_hour).padStart(2, "0")}.00 menghasilkan GMV per jam tertinggi.`,
      });
    }

    const dibawah = benchmarks.filter((b) => b.status === "below");
    if (dibawah.length > 0) {
      out.push({
        key: "live_benchmark_gap",
        tone: "warn",
        title: `${dibawah.length} metrik live di bawah benchmark niche`,
        text: dibawah
          .map((b) => `${b.label}: ${b.unit === "pct" ? persen(b.value) : rupiahShort(b.value ?? 0)} vs benchmark ${b.unit === "pct" ? persen(b.benchmark) : rupiahShort(b.benchmark)}`)
          .join("; ") + ".",
      });
    }

    const diatas = benchmarks.filter((b) => b.status === "above");
    if (diatas.length > 0) {
      out.push({
        key: "live_benchmark_win",
        tone: "good",
        title: `${diatas.length} metrik live sudah di atas benchmark`,
        text: diatas.map((b) => b.label).join(", ") + " sudah melewati benchmark niche.",
      });
    }

    if (live.coverage_ratio !== null && live.coverage_ratio < 0.9) {
      out.push({
        key: "live_coverage",
        tone: "info",
        title: "Sebagian live belum diunggah datanya",
        text: `GMV live menurut data platform ${rupiahShort(live.platform_live_gmv)}, sedangkan sesi yang file-nya sudah diunggah baru ${rupiahShort(live.gmv)} (${persen(live.coverage_ratio)}). Analisa per sesi di bawah hanya mencakup sesi yang datanya ada.`,
      });
    }
  } else {
    out.push({
      key: "live_no_session",
      tone: "info",
      title: "Belum ada data sesi live periode ini",
      text: metrics.live_gmv > 0
        ? `Data platform mencatat GMV live ${rupiahShort(metrics.live_gmv)}, tapi file sesinya belum diunggah dari Jadwal Live — analisa per sesi (jam terbaik, CVR, alur 30 menit) belum bisa dibuat.`
        : "Tidak ada sesi live yang tercatat pada periode ini.",
    });
  }

  // Produk: CTR bagus tapi CTOR jomplang = masalah harga/penawaran, bukan traffic.
  const gapProduk = input.topLive
    .concat(input.topVideo)
    .find((p) => p.ctr !== null && p.ctor !== null && p.ctr > 0 && p.ctor < p.ctr * input.rules.ctor_gap_ratio);
  if (gapProduk) {
    out.push({
      key: "product_ctor_gap",
      tone: "warn",
      title: "Ada produk yang banyak diklik tapi jarang dibeli",
      text: `"${gapProduk.name}" CTR ${persen(gapProduk.ctr)} tapi CTOR hanya ${persen(gapProduk.ctor)} — penonton tertarik, tapi berhenti di halaman produk (harga, stok, atau penawarannya yang perlu dicek).`,
    });
  }

  return out;
}

/**
 * Rekomendasi: aksi konkret yang bisa dikerjakan minggu depan. Sama seperti
 * insight, hanya dibuat bila datanya mendukung.
 */
export function buildRecommendations(input: RulesInput): Recommendation[] {
  const { live, metrics, rules, benchmarks } = input;
  const out: Recommendation[] = [];

  if (live.available && live.best_start_hour !== null) {
    out.push({
      key: "schedule_best_hour",
      text: `Kunci jadwal live utama di pukul ${String(live.best_start_hour).padStart(2, "0")}.00 — jam itu yang GMV per jamnya paling tinggi periode ini.`,
    });
  }
  if (live.available && live.duration_avg_min !== null && live.duration_avg_min < rules.live_duration_target_min) {
    const kurang = rules.live_duration_target_min - live.duration_avg_min;
    out.push({
      key: "extend_duration",
      text: `Tambah ${jam(kurang)} per sesi untuk mencapai target ${jam(rules.live_duration_target_min)}; durasi rata-rata sekarang ${jam(live.duration_avg_min)}.`,
    });
  }
  const ctorRow = benchmarks.find((b) => b.key === "ctor");
  if (ctorRow && ctorRow.status === "below") {
    out.push({
      key: "improve_ctor",
      text: `CTOR ${persen(ctorRow.value)} masih di bawah benchmark ${persen(ctorRow.benchmark)} — perkuat closing: sebut harga & promo saat produk di-pin, jangan hanya menunjukkan produknya.`,
    });
  }
  const ctrRow = benchmarks.find((b) => b.key === "ctr");
  if (ctrRow && ctrRow.status === "below") {
    out.push({
      key: "improve_ctr",
      text: `CTR produk ${persen(ctrRow.value)} di bawah benchmark ${persen(ctrRow.benchmark)} — pin produk lebih sering dan sebutkan keranjang nomor berapa tiap kali ganti produk.`,
    });
  }
  if (metrics.video_share !== null && metrics.video_share < rules.video_share_low && metrics.gmv > 0) {
    out.push({
      key: "video_support",
      text: `Video baru menyumbang ${persen(metrics.video_share)} GMV — unggah minimal 1 video per hari live untuk menopang traffic di luar jam live.`,
    });
  }
  const topLive = input.topLive[0];
  if (topLive) {
    out.push({
      key: "double_down_product",
      text: `Produk "${topLive.name}" penyumbang GMV live terbesar (${rupiahShort(topLive.gmv)}) — pertahankan di rundown sesi berikutnya sebagai produk pembuka.`,
    });
  }
  return out;
}

/** Ringkasan eksekutif (paragraf pembuka report) — fakta, bukan pujian. */
export function buildSummary(input: RulesInput): string {
  const { metrics, deltas, live, periodLabel } = input;
  const bagian: string[] = [];

  bagian.push(
    `${periodLabel}: GMV ${rupiahShort(metrics.gmv)} dari ${metrics.orders.toLocaleString("id-ID")} order` +
      (metrics.aov !== null ? ` (AOV ${rupiahShort(metrics.aov)})` : "") + "."
  );
  if (deltas.gmv !== null) {
    bagian.push(`Dibanding periode sebelumnya ${deltas.gmv >= 0 ? "naik" : "turun"} ${persen(Math.abs(deltas.gmv))}.`);
  }
  if (metrics.live_share !== null) {
    bagian.push(`Kontribusi live ${persen(metrics.live_share)}, video ${persen(metrics.video_share)}.`);
  }
  if (live.available) {
    bagian.push(
      `${live.sessions} sesi live terekam (total ${jam(live.duration_total_min)})` +
        (live.gmv_per_hour !== null ? `, GMV per jam ${rupiahShort(live.gmv_per_hour)}` : "") + "."
    );
  } else {
    bagian.push("Belum ada file sesi live yang diunggah untuk periode ini.");
  }
  return bagian.join(" ");
}

/**
 * Keterbatasan data yang disebut terang-terangan di report — supaya tidak ada
 * yang menunggu angka yang memang tidak ada di export platform.
 */
export function buildDataNotes(input: { liveAvailable: boolean; productSplitAvailable: boolean }): string[] {
  const notes = [
    "Durasi tonton per video dan AWD (average watch duration) tidak tersedia di export platform — tidak ditampilkan dan tidak diperkirakan.",
  ];
  if (!input.productSplitAvailable) {
    notes.push("Pecahan GMV live vs video per produk belum tersedia untuk periode ini (data produk periode ini diunggah sebelum kolomnya ada). Peringkat produk memakai GMV total.");
  }
  if (!input.liveAvailable) {
    notes.push("Analisa per sesi live hanya muncul untuk sesi yang file TikTok LIVE Center-nya diunggah lewat Jadwal Live.");
  }
  return notes;
}

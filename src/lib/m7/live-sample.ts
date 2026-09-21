/**
 * Pembangkit file contoh sesi live TikTok LIVE Center (Product + Trend Stats).
 *
 * Kenapa ada: seluruh jalur "upload sesi live" (M7 Special Project & M13 Jadwal
 * Live) hanya bisa diuji dengan file .xlsx sungguhan — header, tipe nilai, dan
 * nama file adalah bagian dari kontraknya. Sebelum ini tes hanya menyusun baris
 * ad-hoc per berkas tes, sehingga tidak ada satu pun yang menguji rantai
 * penuh nama file → deteksi jenis → parse → verifikasi → simpan → report.
 *
 * Dipakai dua tempat:
 *  - tes end-to-end (`__tests__/live-e2e.test.ts`),
 *  - `scripts/gen-sample-live-files.ts` untuk QA manual tim di staging, selama
 *    export TikTok sungguhan belum tersedia.
 *
 * MURNI: tanpa I/O, tanpa akses jaringan. Header di sini SENGAJA ditulis persis
 * seperti export aslinya (huruf besar/kecil apa adanya) — `normalizeHeader()`
 * yang menormalkannya, jadi kalau normalisasi berubah, tes ini yang jatuh lebih
 * dulu, bukan produksi.
 */
import * as XLSX from "xlsx";

export interface LiveSampleProduct {
  productId: string;
  productName: string;
  gmv: number;
  items: number;
  customers: number;
  orders: number;
  productImpressions: number;
  /** Fraksi 0–1; ditulis ke sheet sebagai persen ("4,2%" → "4.2%"). */
  ctr: number;
  addedToCart: number;
  ctor: number;
  watchGpm: number;
  productClicks: number;
}

export interface LiveSampleSpec {
  username: string;
  sessionNo: number;
  /** ISO yyyy-mm-dd — ikut ke nama file (satu-satunya tempat tanggal hidup). */
  date: string;
  /** "19:00" — jam interval pertama. */
  startTime: string;
  /** Jumlah interval 30 menit; durasi sesi = (intervals − 1) × 30 menit. */
  intervals: number;
  products: LiveSampleProduct[];
  viewersPeak?: number;
  viewsPerInterval?: number;
  impressionsPerInterval?: number;
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "2026-09-17" → "17 September 2026" (bentuk yang dipakai export asli). */
export function sampleDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1] ?? m} ${y}`;
}

/**
 * Nama file export. Bentuknya mengikuti dua bentuk nyata yang sudah dikonfirmasi
 * (lihat `live-filename.ts`): `{username} {apa pun} Sesi {n}, {d Bulan yyyy}.xlsx`.
 */
export function sampleProductFilename(spec: LiveSampleSpec): string {
  return `${spec.username} Product Sesi ${spec.sessionNo}, ${sampleDateLabel(spec.date)}.xlsx`;
}

export function sampleTrendFilename(spec: LiveSampleSpec): string {
  return `${spec.username} Trend Stats Sesi ${spec.sessionNo}, ${sampleDateLabel(spec.date)}.xlsx`;
}

const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

function toXlsx(rows: Record<string, unknown>[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** Sheet Product — sumber kebenaran GMV sesi (§9). */
export function buildProductSheet(spec: LiveSampleSpec): Uint8Array {
  return toXlsx(
    spec.products.map((p) => ({
      "Product ID": p.productId,
      "Product name": p.productName,
      "Attributed GMV": p.gmv,
      "Attributed items sold": p.items,
      Customers: p.customers,
      AOV: p.orders > 0 ? Math.round(p.gmv / p.orders) : 0,
      "Attributed orders": p.orders,
      "Product Impressions": p.productImpressions,
      CTR: pct(p.ctr),
      "Added to cart": p.addedToCart,
      CTOR: pct(p.ctor),
      "Watch GPM": p.watchGpm,
      "Product Clicks": p.productClicks,
    }))
  );
}

/** "19:00" + 3 → "20:30". Melewati tengah malam dibiarkan berputar (24 jam). */
export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Sheet Trend Stats — linimasa 30 menit. GMV-nya dibagi rata ke tiap interval
 * dengan SISA dilempar ke interval terakhir, supaya totalnya PERSIS sama dengan
 * total Product: V6 membandingkan keduanya, dan contoh yang selisih Rp1 gara-gara
 * pembulatan akan memunculkan peringatan palsu di setiap uji.
 */
export function buildTrendSheet(spec: LiveSampleSpec): Uint8Array {
  const totalGmv = spec.products.reduce((a, p) => a + p.gmv, 0);
  const totalOrders = spec.products.reduce((a, p) => a + p.orders, 0);
  const totalItems = spec.products.reduce((a, p) => a + p.items, 0);
  const totalCustomers = spec.products.reduce((a, p) => a + p.customers, 0);
  const totalImpressions = spec.products.reduce((a, p) => a + p.productImpressions, 0);
  const totalClicks = spec.products.reduce((a, p) => a + p.productClicks, 0);

  const n = Math.max(1, spec.intervals);
  const share = (total: number, i: number): number => {
    const base = Math.floor(total / n);
    return i === n - 1 ? total - base * (n - 1) : base;
  };
  const viewersPeak = spec.viewersPeak ?? 120;

  const rows = Array.from({ length: n }, (_, i) => ({
    Time: addMinutes(spec.startTime, i * 30),
    "Attributed GMV": share(totalGmv, i),
    "Attributed items sold": share(totalItems, i),
    Customers: share(totalCustomers, i),
    "Attributed orders": share(totalOrders, i),
    // Puncak penonton jatuh di tengah sesi — bentuk yang wajar, dan membuat
    // `viewers_peak` benar-benar diuji (bukan sekadar nilai konstan).
    Viewers: i === Math.floor(n / 2) ? viewersPeak : Math.round(viewersPeak * 0.6),
    Views: spec.viewsPerInterval ?? 400,
    Impressions: spec.impressionsPerInterval ?? 5_000,
    "Product Impressions": share(totalImpressions, i),
    "Product Clicks": share(totalClicks, i),
    "New followers": 2,
    Shares: 1,
    Comments: 12,
    Likes: 150,
  }));

  return toXlsx(rows);
}

/** Satu sesi lengkap sebagai pasangan (nama file, isi) — siap ditulis ke disk atau dijadikan File. */
export function buildLiveSampleFiles(spec: LiveSampleSpec): { name: string; data: Uint8Array }[] {
  return [
    { name: sampleProductFilename(spec), data: buildProductSheet(spec) },
    { name: sampleTrendFilename(spec), data: buildTrendSheet(spec) },
  ];
}

/** Contoh bawaan: satu sesi beauty 2 jam dengan 4 produk (2 laku, 2 tidak). */
export function defaultSampleSpec(over: Partial<LiveSampleSpec> = {}): LiveSampleSpec {
  return {
    username: "tesakun",
    sessionNo: 1,
    date: "2026-09-17",
    startTime: "19:00",
    intervals: 5,
    viewersPeak: 140,
    products: [
      { productId: "P-1001", productName: "Serum Glow 30ml", gmv: 2_400_000, items: 24, customers: 20, orders: 22, productImpressions: 1_800, ctr: 0.08, addedToCart: 60, ctor: 0.15, watchGpm: 24_000, productClicks: 144 },
      { productId: "P-1002", productName: "Toner Calm 100ml", gmv: 900_000, items: 12, customers: 11, orders: 11, productImpressions: 900, ctr: 0.05, addedToCart: 25, ctor: 0.24, watchGpm: 9_000, productClicks: 45 },
      { productId: "P-1003", productName: "Sunscreen SPF50", gmv: 0, items: 0, customers: 0, orders: 0, productImpressions: 700, ctr: 0.02, addedToCart: 4, ctor: 0, watchGpm: 0, productClicks: 14 },
      { productId: "P-1004", productName: "Sheet Mask 5pcs", gmv: 0, items: 0, customers: 0, orders: 0, productImpressions: 300, ctr: 0.01, addedToCart: 1, ctor: 0, watchGpm: 0, productClicks: 3 },
    ],
    ...over,
  };
}

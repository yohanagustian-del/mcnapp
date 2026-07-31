/**
 * Hapus kreator dari master data (tab Kreator) — kebijakan dependensi.
 *
 * `creators` dirujuk 32 foreign key dari 31 tabel lain, jadi "hapus kreator"
 * tidak bisa sekadar `delete from creators`: DB akan menolak (FK NO ACTION) atau,
 * lebih buruk, meng-cascade data yang seharusnya disimpan. Karena itu setiap
 * anak dikelompokkan eksplisit di sini menjadi dua kelas:
 *
 *  - MATERIAL  : data komersial/historis yang TIDAK bisa dibuat ulang (kontrak,
 *                report terkirim, komisi akuisisi/referral, request campaign,
 *                akun portal, dst). Ada satu baris saja → hapus DITOLAK; kreator
 *                cukup di-set status `nonaktif`.
 *  - DERIVED   : hasil turunan upload data platform mingguan / engine M4-M5.
 *                Tidak bermakna tanpa kreatornya dan akan terbentuk lagi pada
 *                upload berikutnya → ikut dihapus bersama kreator.
 *
 * Tabel baru yang menambah FK ke `creators` dan lupa didaftarkan di sini akan
 * membuat delete gagal dengan error FK dari Postgres — gagal aman (tidak ada
 * data hilang), bukan diam-diam meng-cascade.
 *
 * Daftar ini diturunkan dari information_schema (FK yang menunjuk ke
 * `creators`); kalau menambah tabel baru, daftarkan di salah satu grup.
 */

/** Satu FK anak yang menunjuk ke `creators`. */
export interface CreatorChildRef {
  table: string;
  /** Kolom FK — `referrals` punya dua, jadi tidak selalu `creator_id`. */
  column: string;
  /** Label Bahasa Indonesia untuk pesan penolakan di UI. */
  label: string;
}

/**
 * Data material — satu baris pun memblokir penghapusan.
 *
 * `creator_complaints`, `creator_feedback`, `creator_users` dan
 * `project_join_requests` sengaja ada di sini walau FK-nya CASCADE di DB:
 * cascade itu jaring pengaman skema, sedangkan kebijakan aplikasi lebih ketat —
 * komplain, feedback, akun portal dan request join tidak boleh hilang diam-diam.
 */
export const MATERIAL_CHILDREN: CreatorChildRef[] = [
  { table: "creator_contracts", column: "creator_id", label: "kontrak e-sign" },
  { table: "creator_reports", column: "creator_id", label: "report kreator (M2)" },
  { table: "acquisitions", column: "creator_id", label: "data closing akuisisi" },
  { table: "referrals", column: "referrer_creator_id", label: "referral (sebagai perekrut)" },
  { table: "referrals", column: "new_creator_id", label: "referral (sebagai kreator baru)" },
  { table: "creator_requests", column: "creator_id", label: "request sample/ads/HSL (M8)" },
  { table: "campaign_requests", column: "creator_id", label: "request campaign (M8)" },
  { table: "ads_briefs", column: "creator_id", label: "brief ads (M10)" },
  { table: "deal_live_sessions", column: "creator_id", label: "report sesi live brand" },
  { table: "project_participants", column: "creator_id", label: "peserta special project (M7)" },
  { table: "project_creator_metrics", column: "creator_id", label: "metrik special project (M7)" },
  { table: "project_join_requests", column: "creator_id", label: "request join project (M9)" },
  { table: "external_approaches", column: "creator_id", label: "log approach external" },
  { table: "live_schedule_slots", column: "creator_id", label: "slot jadwal live (M13)" },
  { table: "creator_users", column: "creator_id", label: "akun portal kreator (M9)" },
  { table: "creator_complaints", column: "creator_id", label: "komplain kreator (M9)" },
  { table: "creator_feedback", column: "creator_id", label: "feedback kreator (M9)" },
  { table: "creator_pending_registrations", column: "creator_id", label: "registrasi tertunda" },
  { table: "creators_merge_map", column: "winner_id", label: "riwayat merge kreator" },
];

/**
 * Data turunan — dihapus bersama kreator.
 *
 * Urutan tidak penting (semua difilter by creator_id, tidak ada FK antar mereka
 * yang menghalangi), tapi dijalankan sebelum baris `creators` dihapus.
 */
export const DERIVED_CHILDREN: CreatorChildRef[] = [
  { table: "platform_metrics_raw", column: "creator_id", label: "metrik platform mentah" },
  { table: "transactions_all", column: "creator_id", label: "transaksi (CSV all)" },
  { table: "transactions_agency_link", column: "creator_id", label: "transaksi (CSV agency link)" },
  { table: "agency_links", column: "creator_id", label: "agency link" },
  { table: "creator_link_status", column: "creator_id", label: "status link (M4)" },
  { table: "leakage_products", column: "creator_id", label: "produk bocor (M4)" },
  { table: "creator_period_summary", column: "creator_id", label: "ringkasan per periode" },
  { table: "creator_subcat_segment_gmv", column: "creator_id", label: "GMV per subkategori" },
  { table: "creator_top_products", column: "creator_id", label: "top produk" },
  { table: "metrics_monthly_agg", column: "creator_id", label: "agregat bulanan" },
  { table: "matching_runs", column: "creator_id", label: "hasil matching (M5)" },
  { table: "cpm_report_activity", column: "creator_id", label: "aktivitas report CPM" },
  { table: "creator_report_credits", column: "creator_id", label: "kuota report portal" },
];

/** Jumlah baris material per label, hasil preflight count. */
export type MaterialCounts = Record<string, number>;

/**
 * Alasan penolakan dari hasil count material, atau null kalau kreator aman dihapus.
 *
 * Fungsi murni supaya bisa diuji tanpa DB — server action hanya menyuplai angka.
 */
export function blockReason(counts: MaterialCounts): string | null {
  const hits = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} (${n})`);
  if (hits.length === 0) return null;
  return `masih punya ${hits.join(", ")}`;
}

/** Hasil satu percobaan hapus, per kreator. */
export interface DeleteOutcome {
  id: string;
  /** Username (atau nama) untuk ditampilkan di UI. */
  label: string;
  ok: boolean;
  /** Alasan gagal — hanya terisi saat ok=false. */
  reason?: string;
}

export interface DeleteReport {
  deleted: DeleteOutcome[];
  blocked: DeleteOutcome[];
}

/** Batas jumlah kreator per satu aksi bulk delete — mencegah salah centang masif. */
export const MAX_BULK_DELETE = 50;

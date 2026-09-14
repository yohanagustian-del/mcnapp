/**
 * Label Bahasa Indonesia untuk "Last Activity" adopsi sistem (OKR): dibaca dari
 * audit_logs.action (satu sumber kebenaran, CLAUDE.md #4) — bukan mekanisme log
 * baru. Deterministik: pemetaan tabel, bukan tebakan.
 */
const EXACT: Record<string, string> = {
  "ingest.run": "Upload data GMV/platform",
  "ingest.run_shopee": "Upload data GMV/platform (Shopee)",
  "leak_artifact.upload": "Upload artefak link leakage",
  "m4.engine_run": "Jalankan engine link leakage",
  "m4.leak_compute": "Hitung ulang link leakage",
  "m4.refresh_cooperating_shops": "Refresh shop kerja sama",
  "report.generate": "Buat laporan performa kreator",
  "report.finalize": "Selesaikan laporan performa kreator",
  "m2.token_regression": "Insight report (M2)",
  "m5.run_matching": "Jalankan matching kreator",
  "m6.run_prediction": "Proyeksi GMV",
  "schedule.create_slot": "Bikin jadwal live",
  "schedule.update_slot": "Ubah jadwal live",
  "schedule.delete_slot": "Hapus jadwal live",
  "schedule.verify_slot": "Verifikasi jadwal live",
  "schedule.copy_week": "Salin jadwal live minggu lain",
  "schedule.toggle_roster": "Ubah roster jadwal live",
  "schedule.create_creator": "Tambah kreator ke jadwal live",
};

const PREFIX: [string, string][] = [
  ["m8.deal_report_upload", "Upload report deal"],
  ["m8.deal_proposals_upload", "Upload proposal kreator (deal)"],
  ["m8.deal_session_add", "Tambah sesi live deal"],
  ["m8.brand_report", "Upload report brand"],
  ["m8.acquisition_record", "Catat akuisisi kreator"],
  ["m8.contract", "Kelola kontrak kreator"],
  ["m8.creator_re", "Registrasi ulang kreator"],
  ["m8.creator_register", "Registrasi kreator"],
  ["m8.assign_creator", "Assign kreator"],
  ["m8.", "Aktivitas BizDev/CM"],
  ["m9.complaint", "Tangani komplain kreator"],
  ["m9.", "Aktivitas portal kreator"],
  ["m10.", "Aktivitas ads workspace"],
  ["m3.", "Kelola OKR"],
  ["m12.", "Retensi data"],
  ["creator.import", "Import data kreator"],
  ["creator.bulk_insert", "Import data kreator"],
  ["creator.", "Kelola data kreator"],
  ["creators.", "Kelola data kreator"],
  ["products_tap.", "Kelola produk TAP"],
  ["brand_deal.", "Kelola deal brand"],
  ["bd_project.", "Kelola project BD"],
  ["team_member.", "Kelola anggota tim"],
  ["px_", "Kelola kapabilitas PX"],
  ["password_", "Ganti/reset password"],
];

/** Label ringkas Bahasa Indonesia untuk satu action audit_logs. Fallback: prettify. */
export function describeActivity(action: string): string {
  if (EXACT[action]) return EXACT[action];
  for (const [prefix, label] of PREFIX) {
    if (action.startsWith(prefix)) return label;
  }
  return action
    .replace(/^m\d+\./, "")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

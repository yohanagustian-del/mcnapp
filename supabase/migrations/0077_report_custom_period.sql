-- PLAN_MSDPS_mcnapp.md Paket C (R4, disetujui pemilik 2026-09-28): filter periode
-- Report Kreator ala TikTok Shop Seller Center — Weekly (pilih jendela W1-W5),
-- Monthly (pilih bulan), Custom (pilih rentang, dibulatkan ke jendela W1-W5 utuh).

alter type report_period_t add value if not exists 'custom';

alter table creator_reports add column period_end date;
comment on column creator_reports.period_end is
  'Akhir periode EKSKLUSIF (PLAN_MSDPS Paket C) — sama dengan data_json.period.end_exclusive, disimpan sebagai kolom fisik supaya daftar report bisa menampilkan rentang tanpa membaca data_json. NULL untuk report lama (sebelum migrasi ini); halaman daftar report menurunkannya dari data_json bila kosong.';

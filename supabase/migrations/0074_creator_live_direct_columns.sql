-- PLAN_MSDPS_mcnapp.md Paket E (R6, disetujui pemilik 2026-09-28): Report Kreator
-- tab Live Performance harus bersumber dari file upload MINGGUAN (yang sudah rutin
-- masuk), bukan file TikTok LIVE Center per sesi lewat Jadwal Live. Sample MCN
-- 2026-09-08..09-14 punya 3 kolom live yang selama ini dibuang saat ingest: LIVE
-- direct GMV, LIVE direct orders, Creator LIVE items sold — "% beli langsung saat
-- live" (LIVE direct ÷ LIVE-attributed) tidak bisa dihitung tanpanya.

alter table creator_period_summary
  add column live_direct_gmv numeric not null default 0,
  add column live_direct_orders int not null default 0,
  add column live_items_sold int not null default 0;

alter table creator_top_products
  add column live_direct_gmv numeric not null default 0,
  add column live_direct_orders int not null default 0,
  add column live_items_sold int not null default 0;

comment on column creator_period_summary.live_direct_gmv is
  'GMV live yang closing LANGSUNG saat siaran (subset dari affiliate_live_gmv). "% beli langsung saat live" = live_direct_gmv / affiliate_live_gmv. Batch lama (sebelum migrasi 0074) = 0, dibedakan dari data yang benar-benar nol lewat upload_batch < first batch with this column (report harus bilang "belum tersedia", bukan menampilkan nol — CLAUDE.md #5).';
comment on column creator_top_products.live_direct_gmv is
  'Lihat creator_period_summary.live_direct_gmv — dimensi yang sama, per produk.';

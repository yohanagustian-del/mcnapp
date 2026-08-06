-- Produk TAP: metrik mengikuti export "Custom report" TikTok Partner Compass
-- (Analytics → Custom report, role TAP, ceklis Product + Shop + Product category).
--
-- Upload master lama hanya membaca Product/Shop/Category/Price/Commission. Export
-- Compass yang dipakai tim sekarang membawa metrik performa per produk (Affiliate
-- GMV live/video, orders, items sold, jumlah kreator, komisi estimasi vs aktual,
-- settled GMV, refund, metrik Link). Semua deterministik — ETL SQL/parse, 0 LLM.
--
-- shop_id: export Compass TIDAK selalu memuat kolom shop (tergantung dimensi yang
-- diceklis). Sebelumnya NOT NULL, jadi SETIAP baris export tanpa kolom shop ditolak
-- dan katalog tetap kosong. Dilonggarkan jadi nullable; join ke deal/shop tetap
-- memakai shop_id kalau ada.
alter table products_tap alter column shop_id drop not null;

alter table products_tap
  -- Konteks campaign & periode dari export (satu produk bisa muncul di >1 campaign;
  -- parser mengagregasi per product_id dan menyimpan campaign penyumbang GMV terbesar).
  add column campaign_id text,
  add column campaign_name text,
  add column campaign_count integer,
  add column period_start date,
  add column period_end date,
  -- Metrik GMV
  add column affiliate_gmv numeric,
  add column affiliate_video_gmv numeric,
  add column affiliate_live_gmv numeric,
  add column settled_gmv numeric,
  add column gmv_refund numeric,
  add column revenue_showcase numeric,
  -- Volume
  add column orders integer,
  add column items_sold integer,
  -- Kreator yang menggarap produk (max antar baris, bukan sum — irisan kreator
  -- antar campaign tidak diketahui, menjumlah akan melebih-lebihkan).
  add column collaborated_creators integer,
  add column creators_with_posts integer,
  add column creators_with_sales integer,
  -- Komisi (nominal Rupiah, bukan persen — persen tetap di commission_pct)
  add column est_partner_commission numeric,
  add column actual_partner_commission numeric,
  add column est_creator_commission numeric,
  add column actual_creator_commission numeric,
  -- Metrik "Link" (showcase/link produk) dari export yang sama
  add column link_gmv numeric,
  add column link_items_sold integer,
  add column link_orders integer,
  add column link_partner_est_commission numeric,
  add column link_creator_est_commission numeric,
  -- Rate komisi partner (%) — pendamping commission_pct (rate kreator)
  add column partner_commission_pct numeric,
  -- Metadata produk dari export campaign product list
  add column product_link text,
  add column effective_start date,
  add column effective_end date;

comment on column products_tap.commission_pct is
  'Rate komisi KREATOR dalam persen (Creator commission rate). Kotor/tidak terparse → null + needs_review.';
comment on column products_tap.collaborated_creators is
  'Max antar baris export (bukan sum) — irisan kreator antar campaign tidak diketahui.';

create index products_tap_affiliate_gmv_idx on products_tap (affiliate_gmv desc nulls last);
create index products_tap_campaign_idx on products_tap (campaign_id);

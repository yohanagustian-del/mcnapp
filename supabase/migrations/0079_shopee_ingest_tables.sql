-- SUSULAN DRIFT (lihat 0078 untuk konteks lengkap): dua tabel agregat ingest Shopee
-- baru, diterapkan langsung ke staging & production 2026-09-26 sebagai
-- "shopee_ingest_tables" tanpa file repo. Butuh 0078 (kolom platform sudah ada di
-- tabel lain; tabel di bawah lahir SUDAH platform-aware).
--
-- Sumbernya export per-kreator dari ZIP Shopee ("Sample_Data_10_Creator_1.zip" —
-- lihat catatan Fase 1B): satu ZIP berisi file per kreator, tiap file punya sheet
-- overview per channel (live/video) dan sheet ringkasan komisi affiliate. Pipeline
-- pembacanya (lib/ingest/shopee/aggregate.ts buildChannelStats) BELUM ada di repo
-- ini — tabelnya duluan, kodenya menyusul. Nilai app_config di bawah adalah
-- toleransi parsing/validasi ZIP itu.

create table if not exists creator_period_channel_stats (
  id bigserial primary key,
  creator_id text not null references creators(id),
  platform text not null default 'shopee' check (platform in ('tiktok', 'shopee')),
  period_start date not null,
  period_end date not null,
  channel text not null check (channel in ('live', 'video')),
  upload_batch text not null,
  sessions int,
  duration_sec int,
  avg_duration_sec int,
  gmv_created numeric,
  gmv_ready numeric,
  orders_created int,
  orders_ready int,
  items_created int,
  items_ready int,
  products_promoted int,
  viewers int,
  active_viewers int,
  avg_watch_sec int,
  buyers_created int,
  buyers_ready int,
  add_to_cart int,
  product_clicks int,
  click_rate numeric,
  orders_per_click numeric,
  aov_created numeric,
  gpm numeric,
  views int,
  peak_viewers int,
  likes int,
  shares int,
  comments int,
  new_followers int,
  voucher_store_claimed int,
  voucher_live_claimed int,
  coins_claimed int,
  export_date date,
  list_rows int,
  list_capped boolean,
  coverage_ratio numeric,
  created_at timestamptz default now(),
  constraint creator_period_channel_stats_uniq unique (creator_id, period_start, channel, upload_batch)
);
create index if not exists creator_period_channel_stats_batch_idx on creator_period_channel_stats (upload_batch);
create index if not exists creator_period_channel_stats_platform_idx on creator_period_channel_stats (platform, creator_id, period_start);

alter table creator_period_channel_stats enable row level security;
drop policy if exists cpcs_select on creator_period_channel_stats;
create policy cpcs_select on creator_period_channel_stats for select to authenticated using (true);
-- Beda dari kebanyakan tabel agregat internal: kreator BOLEH lihat baris miliknya
-- sendiri (portal produk Shopee), makanya restrictive-nya selektif, bukan full deny.
drop policy if exists cpcs_creator_selfonly on creator_period_channel_stats;
create policy cpcs_creator_selfonly on creator_period_channel_stats as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());
-- writes via service role only (ingest pipeline).

comment on table creator_period_channel_stats is
  'Engagement per (kreator × window × channel live/video) dari ZIP kreator Shopee: overview + fakta product list (list_rows/list_capped/coverage_ratio). Ditulis pipeline ingest (lib/ingest/shopee/aggregate.ts buildChannelStats). Kolom yang tidak ada di export channel itu = null, bukan 0. Rate dalam satuan persen.';

create table if not exists creator_period_commission (
  id bigserial primary key,
  creator_id text not null references creators(id),
  platform text not null default 'shopee' check (platform in ('tiktok', 'shopee')),
  period_start date not null,
  period_end date not null,
  upload_batch text not null,
  seller_gmv numeric,
  orders int,
  est_affiliate_commission numeric,
  est_promo_fee numeric,
  est_management_fee numeric,
  roi numeric,
  created_at timestamptz default now()
);
create index if not exists creator_period_commission_batch_idx on creator_period_commission (upload_batch);
create index if not exists creator_period_commission_platform_idx on creator_period_commission (platform, creator_id, period_start);

alter table creator_period_commission enable row level security;
drop policy if exists cpcm_select on creator_period_commission;
create policy cpcm_select on creator_period_commission for select to authenticated using (true);
drop policy if exists cpcm_creator_deny on creator_period_commission;
create policy cpcm_creator_deny on creator_period_commission as restrictive for select
  using (not is_creator_user());
-- writes via service role only (ingest pipeline).

comment on table creator_period_commission is
  'Snapshot mingguan export all_affiliates Shopee per kreator: GMV seller, pesanan, estimasi komisi affiliate / jasa promo / biaya manajemen, ROI. Internal/finance — restrictive deny untuk is_creator_user().';

insert into app_config (key, value) values
  ('shopee.gmv_mismatch_warn', '0.25'),
  ('shopee.name_match_warn_rate', '0.3'),
  ('shopee.overview_list_tolerance', '0.01'),
  ('shopee.product_list_cap', '1000'),
  ('shopee.zip_max_creators', '60')
on conflict (key) do nothing;

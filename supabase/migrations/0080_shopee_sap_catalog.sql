-- SUSULAN DRIFT (lihat 0078 untuk konteks lengkap): tabel agregat mingguan dari
-- export SAP (Campaign Performance MCN Shopee), diterapkan langsung ke staging &
-- production 2026-09-26 sebagai "shopee_sap_catalog" tanpa file repo. Butuh 0078
-- (kolom `platform` sudah pola yang sama di tabel lain).

create table if not exists shopee_sap_creator_items (
  id bigserial primary key,
  week date not null,
  creator_id text not null references creators(id),
  platform text not null default 'shopee' check (platform in ('tiktok', 'shopee')),
  upload_batch text not null,
  affiliate_id text,
  user_id text,
  item_id text not null,
  item_name text,
  item_name_norm text,
  shop_id text,
  shop_name text,
  campaign_id text not null,
  campaign_name text,
  campaign_type text check (campaign_type in ('same_mcn', 'cross_mcn')),
  l0_category text,
  l1_category text,
  channels text[] not null default '{}' check (channels <@ array['live', 'video', 'ext_affil']::text[]),
  videos_posted int,
  streams int,
  first_video_date date,
  first_stream_date date,
  created_at timestamptz default now(),
  constraint shopee_sap_creator_items_uniq unique (week, creator_id, item_id, campaign_id)
);
create index if not exists shopee_sap_creator_items_batch_idx on shopee_sap_creator_items (upload_batch);
create index if not exists shopee_sap_creator_items_creator_week_idx on shopee_sap_creator_items (creator_id, week);
create index if not exists shopee_sap_creator_items_item_name_norm_idx on shopee_sap_creator_items (item_name_norm);

alter table shopee_sap_creator_items enable row level security;
drop policy if exists ssci_select on shopee_sap_creator_items;
create policy ssci_select on shopee_sap_creator_items for select to authenticated using (true);
-- Internal-only (agregat kampanye, bukan data yang ditujukan untuk kreator) — deny
-- penuh untuk is_creator_user(), pola sama dengan products_tap/brand_leads (CLAUDE.md #9).
drop policy if exists ssci_creator_deny on shopee_sap_creator_items;
create policy ssci_creator_deny on shopee_sap_creator_items as restrictive for select
  using (not is_creator_user());
-- writes via service role only (ingest pipeline, lib/ingest/shopee/run-sap.ts).

comment on table shopee_sap_creator_items is
  'Agregat mingguan export SAP (Campaign Performance MCN Shopee) per (week × kreator × item × campaign): hitungan video/stream dijumlah per window W1-W5, tanggal pertama = MIN, channels = gabungan, campaign_type = same_mcn bila ada hari Same-MCN. Tanpa GMV. Ditulis lib/ingest/shopee/run-sap.ts; retensi app_config retention.sap_items_weeks. Restrictive deny untuk is_creator_user().';

insert into app_config (key, value) values
  ('retention.sap_items_weeks', '26')
on conflict (key) do nothing;

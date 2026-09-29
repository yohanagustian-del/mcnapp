-- SUSULAN DRIFT (lihat 0078 untuk konteks lengkap): products_tap.shop_key dan
-- brand_deals.shop_key (generated columns, 0043/0047) dibuat platform-aware,
-- diterapkan langsung ke staging & production 2026-09-26 sebagai
-- "0075_shop_key_platform_aware" tanpa file repo. Butuh 0078 (kolom `platform`).
--
-- KENAPA: shop_key sebelumnya = shop_name → #shop_id → "(tanpa shop)", TANPA
-- platform. Begitu produk Shopee & TikTok hidup di tabel yang sama (0078), dua shop
-- BEDA PLATFORM dengan nama/nomor sama akan salah melebur jadi satu baris di tabel
-- "Shop" (tab Deal Brand) — melanggar CLAUDE.md #4 (satu sumber kebenaran, bukan
-- kebetulan tabrakan). Perbaikannya: prefix shop_key dengan platform.
--
-- Postgres tidak bisa ALTER kolom generated di tempat (harus drop+add ulang);
-- kolom stored generated dihitung ulang otomatis untuk seluruh baris saat
-- ditambahkan kembali, jadi ini aman dijalankan ulang pada data yang sudah ada.
-- Ekspresi brand_deals.shop_key tetap SAMA PERSIS dengan products_tap.shop_key
-- (hanya prefix platform ditambahkan pada keduanya) — invarian CLAUDE.md #4/#6
-- yang mengharuskan shop_key dua tabel itu tidak pernah berbeda tetap terjaga.

drop view if exists deal_shop_summary;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products_tap' and column_name='shop_key'
      and (select generation_expression from information_schema.columns
           where table_schema='public' and table_name='products_tap' and column_name='shop_key') ilike 'platform%'
  ) then
    drop index if exists products_tap_shop_key_idx;
    alter table products_tap drop column if exists shop_key;
    alter table products_tap add column shop_key text generated always as (
      platform || ':' || coalesce(nullif(btrim(shop_name), ''), '#' || shop_id, '(tanpa shop)')
    ) stored;
    create index products_tap_shop_key_idx on products_tap (shop_key);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='brand_deals' and column_name='shop_key'
      and (select generation_expression from information_schema.columns
           where table_schema='public' and table_name='brand_deals' and column_name='shop_key') ilike 'platform%'
  ) then
    drop index if exists brand_deals_shop_key_idx;
    alter table brand_deals drop column if exists shop_key;
    alter table brand_deals add column shop_key text generated always as (
      platform || ':' || coalesce(nullif(btrim(brand_name), ''), '#' || shop_id, '(tanpa shop)')
    ) stored;
    create index brand_deals_shop_key_idx on brand_deals (shop_key);
  end if;
end $$;

comment on column products_tap.shop_key is
  'Kunci grup shop, platform-aware (platform:Shop Name → platform:#shop_id → platform:(tanpa shop)) sejak SUSULAN DRIFT 2026-09-26 — sebelumnya tanpa prefix platform. Dipakai view deal_shop_summary untuk mengelompokkan dan form Edit shop di tab Deal Brand untuk memilih anggota grup.';
comment on column brand_deals.shop_key is
  'Kunci grup shop, ekspresi yang SAMA PERSIS dengan products_tap.shop_key (termasuk prefix platform, CLAUDE.md #4/#6) — jangan pernah menyalin ekspresi ini ke filter aplikasi.';

-- View dibuat ulang dengan kolom `platforms` (union platform kartu produk & deal
-- shop yang sama) — isi & urutan kolom lama sama persis dengan 0047.
create view deal_shop_summary
with (security_invoker = on) as
with uang as (
  select shop_key,
         sum(ads_budget) as ads_budget,
         sum(service_fee) as service_fee
  from bd_project_shop_budgets
  group by shop_key
),
kartu as (
  select
    p.shop_key,
    max(nullif(btrim(p.shop_name), '')) as shop_name,
    min(p.shop_id) as shop_id,
    count(distinct p.shop_id) as shop_id_count,
    count(*) filter (where p.shop_id is null) as shop_id_missing,
    count(*) as product_count,
    count(*) filter (where p.active) as active_count,
    count(*) filter (where p.needs_review) as needs_review_count,
    count(distinct p.campaign_id) filter (where p.campaign_id <> '-') as campaign_count,
    array_remove(array_agg(distinct p.campaign_type), null) as campaign_types,
    array_remove(array_agg(distinct p.deal_by), null) as deal_by_ids,
    array_remove(array_agg(distinct p.pic_tap), null) as pic_tap_ids,
    array_remove(array_agg(distinct p.uploaded_by), null) as uploaded_by_ids,
    sum(p.affiliate_gmv) as gmv_tap,
    avg(p.price) as avg_price,
    avg(p.commission_pct) as avg_commission_pct,
    avg(p.partner_commission_pct) as avg_partner_commission_pct,
    min(p.effective_start) as effective_start,
    max(p.effective_end) as effective_end,
    max(p.last_seen) as last_seen,
    array_remove(array_agg(distinct p.platform), null) as platforms
  from products_tap p
  group by p.shop_key
),
deal as (
  select
    d.shop_key,
    max(nullif(btrim(d.brand_name), '')) as shop_name,
    min(d.shop_id) as shop_id,
    count(distinct d.shop_id) as shop_id_count,
    count(*) filter (where d.shop_id is null) as shop_id_missing,
    count(*) as deal_count,
    min(d.id) as deal_id,
    count(distinct d.campaign_id) as campaign_count,
    array_remove(array_agg(distinct d.campaign_type), null) as campaign_types,
    array_remove(array_agg(distinct d.pic_tap), null) as pic_tap_ids,
    array_remove(array_agg(distinct d.created_by), null) as uploaded_by_ids,
    count(*) filter (
      where jsonb_array_length(coalesce(d.review_flags, '[]'::jsonb)) > 0
    ) as needs_review_count,
    sum(d.gmv_tap) as gmv_tap,
    avg(d.avg_price) as avg_price,
    avg(d.komisi_kreator_pct) as avg_commission_pct,
    avg(d.komisi_mea_pct) as avg_partner_commission_pct,
    min(d.deal_start) as effective_start,
    max(d.exp_date) as effective_end,
    array_remove(array_agg(distinct d.platform), null) as platforms
  from brand_deals d
  group by d.shop_key
)
select
  k.shop_key,
  k.shop_name,
  k.shop_id,
  k.shop_id_count,
  k.shop_id_missing,
  k.product_count,
  k.active_count,
  k.needs_review_count,
  k.campaign_count,
  k.campaign_types,
  k.deal_by_ids,
  k.pic_tap_ids,
  k.uploaded_by_ids,
  coalesce(d.deal_count, 0::bigint) as deal_count,
  d.deal_id,
  u.ads_budget,
  u.service_fee,
  k.gmv_tap,
  k.avg_price,
  k.avg_commission_pct,
  k.avg_partner_commission_pct,
  k.effective_start,
  k.effective_end,
  k.last_seen,
  array(select distinct pl from unnest(k.platforms || coalesce(d.platforms, '{}'::text[])) pl order by pl) as platforms
from kartu k
left join deal d using (shop_key)
left join uang u using (shop_key)

union all

select
  d.shop_key,
  d.shop_name,
  d.shop_id,
  d.shop_id_count,
  d.shop_id_missing,
  0::bigint as product_count,
  0::bigint as active_count,
  d.needs_review_count,
  d.campaign_count,
  d.campaign_types,
  '{}'::uuid[] as deal_by_ids,
  d.pic_tap_ids,
  d.uploaded_by_ids,
  d.deal_count,
  d.deal_id,
  u.ads_budget,
  u.service_fee,
  d.gmv_tap,
  d.avg_price,
  d.avg_commission_pct,
  d.avg_partner_commission_pct,
  d.effective_start,
  d.effective_end,
  null::date as last_seen,
  d.platforms
from deal d
left join uang u using (shop_key)
where not exists (select 1 from kartu k where k.shop_key = d.shop_key);

comment on view deal_shop_summary is
  'Satu baris per shop untuk tabel "Shop" di tab Deal Brand: kartu products_tap diringkas per shop_key, ditambah shop yang baru ada di brand_deals (deal tanpa kartu produk). Kedua sumber memakai kolom generated shop_key yang sama (platform-aware sejak 0082). Ads budget & service fee = TOTAL bd_project_shop_budgets lintas project; GMV dijumlah; harga & rate komisi dirata-rata; campaign sentinel "-" tidak dihitung. Kolom platforms = union platform kartu produk & deal shop yang sama.';

grant select on deal_shop_summary to authenticated;

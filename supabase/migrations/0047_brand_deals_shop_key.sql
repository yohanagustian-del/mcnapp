-- Deal shop (baris brand_deals) ikut bisa dirapikan dari tabel "Shop" di tab Deal Brand.
--
-- Sejak 0046 Registrasi Deal yang produknya belum diketahui membuat baris `brand_deals`,
-- dan baris itu tampil di tabel Shop sebagai baris ber-0 kartu. Tombol Edit di tabel itu
-- menulis Shop ID & Tipe Campaign ke SELURUH anggota grup shop — tapi anggotanya dicari
-- lewat `products_tap.shop_key`, jadi untuk shop yang belum punya kartu tombolnya tidak
-- menemukan apa pun. Akibatnya Shop ID sebuah deal shop tidak bisa diisi dari mana pun
-- (halaman detail deal lama tidak punya form edit).
--
-- Perbaikannya mengikuti pola 0043 persis: kunci grupnya dijadikan KOLOM GENERATED,
-- bukan ekspresi yang disalin ke filter aplikasi (CLAUDE.md #4). Ekspresinya sama kata
-- per kata dengan products_tap.shop_key, jadi satu shop selalu jatuh ke grup yang sama
-- entah wujudnya kartu produk, baris deal, atau keduanya.

alter table brand_deals
  add column shop_key text generated always as (
    coalesce(nullif(btrim(brand_name), ''), '#' || shop_id, '(tanpa shop)')
  ) stored;

comment on column brand_deals.shop_key is
  'Kunci grup shop (Shop Name/brand_name → #shop_id → "(tanpa shop)"), ekspresi yang sama dengan products_tap.shop_key. Dipakai view deal_shop_summary untuk melebur deal & kartu shop yang sama, dan tombol Edit shop di tab Deal Brand untuk memilih anggota grup.';

create index brand_deals_shop_key_idx on brand_deals (shop_key);

-- View dibuat ulang agar cabang `deal` mengelompokkan lewat kolom di atas alih-alih
-- mengulang ekspresinya. Isi & urutan kolomnya sama persis dengan 0046.
drop view deal_shop_summary;

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
    -- '-' = sentinel baris tanpa campaign (derive ingest mingguan), bukan campaign.
    count(distinct p.campaign_id) filter (where p.campaign_id <> '-') as campaign_count,
    array_remove(array_agg(distinct p.campaign_type), null) as campaign_types,
    array_remove(array_agg(distinct p.deal_by), null) as deal_by_ids,
    array_remove(array_agg(distinct p.pic_tap), null) as pic_tap_ids,
    array_remove(array_agg(distinct p.uploaded_by), null) as uploaded_by_ids,
    sum(p.affiliate_gmv) as gmv_tap,
    -- Harga & rate komisi DIRATA-RATA: menjumlah persen tidak punya arti.
    avg(p.price) as avg_price,
    avg(p.commission_pct) as avg_commission_pct,
    avg(p.partner_commission_pct) as avg_partner_commission_pct,
    min(p.effective_start) as effective_start,
    max(p.effective_end) as effective_end,
    max(p.last_seen) as last_seen
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
    -- Dipakai tabel Deal Brand untuk menautkan baris ke halaman detail deal.
    min(d.id) as deal_id,
    count(distinct d.campaign_id) as campaign_count,
    array_remove(array_agg(distinct d.campaign_type), null) as campaign_types,
    array_remove(array_agg(distinct d.pic_tap), null) as pic_tap_ids,
    -- created_by = akun yang mendaftarkan deal, semantik yang sama dengan kolom
    -- "Nama BD" (products_tap.uploaded_by) di tabel shop.
    array_remove(array_agg(distinct d.created_by), null) as uploaded_by_ids,
    count(*) filter (
      where jsonb_array_length(coalesce(d.review_flags, '[]'::jsonb)) > 0
    ) as needs_review_count,
    sum(d.gmv_tap) as gmv_tap,
    avg(d.avg_price) as avg_price,
    avg(d.komisi_kreator_pct) as avg_commission_pct,
    avg(d.komisi_mea_pct) as avg_partner_commission_pct,
    min(d.deal_start) as effective_start,
    max(d.exp_date) as effective_end
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
  k.last_seen
from kartu k
left join deal d using (shop_key)
left join uang u using (shop_key)

union all

-- Shop yang baru ada di brand_deals: deal terdaftar, kartu produknya belum.
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
  null::date as last_seen
from deal d
left join uang u using (shop_key)
where not exists (select 1 from kartu k where k.shop_key = d.shop_key);

comment on view deal_shop_summary is
  'Satu baris per shop untuk tabel "Shop" di tab Deal Brand: kartu products_tap diringkas per shop_key, ditambah shop yang baru ada di brand_deals (deal tanpa kartu produk). Kedua sumber memakai kolom generated shop_key yang sama. Ads budget & service fee = TOTAL bd_project_shop_budgets lintas project; GMV dijumlah; harga & rate komisi dirata-rata; campaign sentinel "-" tidak dihitung.';

grant select on deal_shop_summary to authenticated;

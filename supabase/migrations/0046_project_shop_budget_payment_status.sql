-- Ads Budget & Service Fee jadi nominal PER (project, shop), + status payment project,
-- + shop yang didaftarkan tanpa kartu produk ikut tampil di tab Deal Brand.
--
-- MASALAH YANG DIPERBAIKI. Sebelumnya kedua nominal itu kolom per-kartu di
-- products_tap yang dijumlah per shop, dan form Edit di tab Project BD menaruh nilai
-- penuh di satu kartu lalu menol-kan sisanya supaya penjumlahannya pas. Akibatnya
-- satu shop hanya bisa punya SATU nominal: DVARA di project "Alya 2" dan DVARA di
-- project lain berebut angka yang sama, padahal keduanya kesepakatan berbeda.
--
-- SESUDAH INI nominal itu milik PASANGAN (project, shop):
--   - Detail & daftar Project BD → nominal project itu saja.
--   - Tabel shop di tab Deal Brand → TOTAL lintas semua project yang menggarapnya.
-- products_tap.ads_budget / service_fee tidak lagi dibaca maupun ditulis aplikasi
-- (ditandai deprecated di bawah); kolomnya dibiarkan sebagai rekaman nilai lama.

-- ============ 1. Status payment project ============
alter table bd_projects
  add column status_payment text
    check (status_payment in ('done', 'proses_finance_payment', 'proses_finance_brand'));

comment on column bd_projects.status_payment is
  'Status pembayaran project: done | proses_finance_payment | proses_finance_brand. Null = belum diisi.';

-- ============ 2. Nominal per (project, shop) ============
-- FK KOMPOSIT ke bd_project_shops, bukan ke bd_projects: nominal hanya sah untuk shop
-- yang memang anggota project itu, dan ikut hilang kalau shopnya dikeluarkan dari
-- project. Konsekuensinya saveBdProject menyimpan daftar shop secara SELISIH (hapus
-- yang keluar, tambah yang masuk) — hapus-lalu-tulis-ulang seluruhnya akan menghapus
-- nominal setiap kali nama project diubah.
create table bd_project_shop_budgets (
  project_id text not null,
  -- = products_tap.shop_key / bd_project_shops.shop_key.
  shop_key text not null,
  ads_budget numeric,
  service_fee numeric,
  updated_by uuid references team_members(id),
  updated_at timestamptz default now(),
  primary key (project_id, shop_key),
  foreign key (project_id, shop_key)
    references bd_project_shops (project_id, shop_key) on delete cascade
);

create index bd_project_shop_budgets_shop_idx on bd_project_shop_budgets (shop_key);

comment on table bd_project_shop_budgets is
  'Ads Budget & Service Fee satu shop DALAM satu Project BD — sumber tunggal kedua nominal. Detail project membacanya per project; tabel shop di tab Deal Brand menjumlahkannya lintas project.';

alter table bd_project_shop_budgets enable row level security;
-- Pola yang sama dengan bd_projects (0044): baca untuk semua akun tim, tulis lewat
-- service role di server action yang sudah menegakkan requirePermission.
create policy bd_project_shop_budgets_read on bd_project_shop_budgets
  for select to authenticated using (true);

-- ============ 3. Pindahkan nominal lama yang TIDAK ambigu ============
-- Hanya shop yang jadi anggota TEPAT SATU project: di situ "total shop" = "total
-- project", jadi pemindahannya eksak dan totalnya di tab Deal Brand tidak berubah.
--
-- Shop yang ada di beberapa project (pembagian per project tidak diketahui) dan shop
-- yang belum masuk project mana pun SENGAJA tidak dikarang — angkanya diisi ulang
-- lewat tombol Edit di detail project, dan nilai lamanya tetap terbaca di kolom
-- products_tap yang ditandai deprecated di bawah.
insert into bd_project_shop_budgets (project_id, shop_key, ads_budget, service_fee)
select tunggal.project_id, uang.shop_key, uang.ads_budget, uang.service_fee
from (
  select shop_key,
         sum(ads_budget) as ads_budget,
         sum(service_fee) as service_fee
  from products_tap
  group by shop_key
  having sum(ads_budget) is not null or sum(service_fee) is not null
) uang
join (
  select shop_key, min(project_id) as project_id
  from bd_project_shops
  group by shop_key
  having count(*) = 1
) tunggal on tunggal.shop_key = uang.shop_key;

-- Satu pembagian yang TIDAK ambigu meski shopnya ada di dua project, karena
-- pemiliknya menyebutkannya sendiri saat meminta perubahan ini: nominal DVARA
-- (ads 212.212 / fee 1.231) adalah nominal project "alya 2", bukan project lain yang
-- juga menggarap DVARA. Dituliskan lewat NAMA project + shop_key (bukan id yang
-- di-generate) dan idempoten, jadi aman diulang di database mana pun.
insert into bd_project_shop_budgets (project_id, shop_key, ads_budget, service_fee)
select s.project_id, s.shop_key, 212212, 1231
from bd_project_shops s
join bd_projects p on p.id = s.project_id
where lower(btrim(p.name)) = 'alya 2' and s.shop_key = 'DVARA'
on conflict (project_id, shop_key) do nothing;

comment on column products_tap.ads_budget is
  'DEPRECATED sejak 0046: nominal pindah ke bd_project_shop_budgets (per project + shop). Tidak dibaca/ditulis aplikasi lagi — disimpan sebagai rekaman nilai lama.';
comment on column products_tap.service_fee is
  'DEPRECATED sejak 0046: lihat catatan pada ads_budget.';

-- ============ 4. Tabel shop tab Deal Brand ============
-- View ini mengganti products_tap_shop_summary, dan namanya ikut berubah karena
-- sumbernya tidak lagi cuma products_tap:
--
--   a. Nominal (ads budget, service fee) datang dari bd_project_shop_budgets —
--      dijumlah lintas project, sesuai permintaan: "DVARA di Alya 2 ditambah DVARA
--      di project lain".
--   b. Shop yang didaftarkan TANPA kartu produk (Registrasi Deal yang hanya berisi
--      Shop Name) hidup di brand_deals, bukan products_tap. Tanpa cabang deal_only
--      di bawah, shop seperti itu tidak akan pernah terlihat di aplikasi.
--
-- Cabang `card` sengaja identik dengan view 0045 (kolomnya sama, ekspresinya sama),
-- jadi angka shop yang sudah punya kartu TIDAK berubah gara-gara migrasi ini. Baris
-- deal_only murni TAMBAHAN: hanya untuk shop yang belum punya satu pun kartu.
--
-- Kolom *_missing (jumlah kartu tanpa nominal) dibuang: nominal bukan atribut kartu
-- lagi, jadi hitungan itu tidak punya arti.
drop view products_tap_shop_summary;

create view deal_shop_summary
with (security_invoker = on) as
with uang as (
  -- Total nominal shop = jumlah yang diinput di SEMUA project yang menggarapnya.
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
  -- Baris brand_deals diringkas dengan kunci shop yang SAMA dengan products_tap,
  -- jadi begitu kartu produk shop itu didaftarkan keduanya melebur ke satu baris.
  select
    coalesce(nullif(btrim(d.brand_name), ''), '#' || d.shop_id, '(tanpa shop)') as shop_key,
    max(nullif(btrim(d.brand_name), '')) as shop_name,
    min(d.shop_id) as shop_id,
    count(distinct d.shop_id) as shop_id_count,
    count(*) filter (where d.shop_id is null) as shop_id_missing,
    count(*) as deal_count,
    -- Dipakai tabel Deal Brand untuk menautkan baris ke halaman detail deal lama.
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
  group by 1
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
  'Satu baris per shop untuk tabel "Shop" di tab Deal Brand: kartu products_tap diringkas per shop_key, ditambah shop yang baru ada di brand_deals (deal tanpa kartu produk). Ads budget & service fee = TOTAL bd_project_shop_budgets lintas project; GMV dijumlah; harga & rate komisi dirata-rata; campaign sentinel "-" tidak dihitung.';

grant select on deal_shop_summary to authenticated;

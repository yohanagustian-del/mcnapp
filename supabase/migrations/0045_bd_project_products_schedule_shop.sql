-- Tiga penambahan kecil yang saling terkait — semuanya "membaca sumber yang sudah
-- ada", bukan menyalin angka baru (CLAUDE.md #4):
--
--  1. products_tap_shop_summary dapat kolom uploaded_by_ids → tabel "Shop dari
--     Produk TAP" (tab Deal Brand) bisa menampilkan kolom Nama BD, sejajar dengan
--     tabel Produk TAP. Kolomnya sekadar kumpulan pemilik kartu shop itu.
--  2. bd_project_products: kartu produk mana saja di shop-shop sebuah Project BD
--     yang benar-benar DIKERJASAMAKAN. Sebelumnya "Produk yang Dikerjasamakan"
--     menampilkan SEMUA kartu shop project — padahal satu shop bisa punya ratusan
--     kartu dan hanya sebagian yang masuk campaign.
--  3. live_schedule_slots.shop_key: slot jadwal live kini ditautkan ke SHOP dari
--     tabel "Shop dari Produk TAP", bukan hanya ke baris brand_deals lama. Dari
--     tautan inilah notifikasi PIC TAP di sidebar dihitung.

-- ============ 1. Nama BD di ringkasan shop ============
-- View dibuat ulang (bukan diubah) karena Postgres tidak bisa menambah kolom di
-- tengah definisi view. Isinya sama persis dengan migrasi 0043 + satu kolom.
drop view products_tap_shop_summary;

create view products_tap_shop_summary
with (security_invoker = on) as
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
  -- Pemilik kartu (akun yang menginput/upload) = kolom "Nama BD" di tabel Produk
  -- TAP. Baris hasil derive ingest tidak punya pemilik → tidak menyumbang nama.
  array_remove(array_agg(distinct p.uploaded_by), null) as uploaded_by_ids,

  -- Nominal komersial DIJUMLAH: total komitmen MEA ke shop ini lintas kartu.
  sum(p.ads_budget) as ads_budget,
  sum(p.service_fee) as service_fee,
  count(*) filter (where p.ads_budget is null) as ads_budget_missing,
  count(*) filter (where p.service_fee is null) as service_fee_missing,
  sum(p.affiliate_gmv) as gmv_tap,
  -- Harga & rate komisi DIRATA-RATA: menjumlah persen tidak punya arti.
  avg(p.price) as avg_price,
  avg(p.commission_pct) as avg_commission_pct,
  avg(p.partner_commission_pct) as avg_partner_commission_pct,

  min(p.effective_start) as effective_start,
  max(p.effective_end) as effective_end,
  max(p.last_seen) as last_seen
from products_tap p
group by p.shop_key;

comment on view products_tap_shop_summary is
  'Ringkasan products_tap per shop_key untuk tabel shop di tab Deal Brand. Nominal (ads budget, service fee, GMV) dijumlah; harga & rate komisi dirata-rata; campaign sentinel "-" tidak dihitung sebagai campaign. Kolom *_ids = pemilik dimensi kartu (deal by, PIC TAP, Nama BD); kolom *_missing = jumlah kartu yang kolomnya masih kosong, dipakai form Edit shop.';

grant select on products_tap_shop_summary to authenticated;

-- ============ 2. Produk yang dikerjasamakan per Project BD ============
-- Yang disimpan HANYA kuncinya: atribut produk (harga, komisi, masa berlaku)
-- tetap dibaca dari products_tap, tidak pernah disalin ke sini.
--
-- FK komposit ke products_tap: kalau kartunya dihapus dari katalog, pilihannya
-- ikut hilang — daftar kerja sama tidak boleh menunjuk kartu yang sudah tiada.
create table bd_project_products (
  project_id text references bd_projects(id) on delete cascade not null,
  campaign_id text not null,
  product_id text not null,
  added_by uuid references team_members(id),
  added_at timestamptz default now(),
  primary key (project_id, campaign_id, product_id),
  foreign key (campaign_id, product_id)
    references products_tap (campaign_id, product_id) on delete cascade
);

create index bd_project_products_product_idx on bd_project_products (campaign_id, product_id);

comment on table bd_project_products is
  'Kartu produk (products_tap) yang dicentang sebagai "dikerjasamakan" pada sebuah Project BD. Hanya kunci yang disimpan — atribut produknya dibaca dari products_tap.';

alter table bd_project_products enable row level security;
-- Sama seperti bd_projects (0044): baca untuk semua akun tim, tulis lewat service
-- role di server action yang sudah menegakkan requirePermission.
create policy bd_project_products_read on bd_project_products
  for select to authenticated using (true);

-- ============ 3. Slot jadwal live → shop dari Produk TAP ============
-- Pertanyaan "Link ke deal (opsional)" di form slot kini memilih SHOP dari tabel
-- "Shop dari Produk TAP", bukan brand_deals. Nilainya = products_tap.shop_key
-- (kolom generated, migrasi 0043) — kunci yang sama dengan view ringkasan.
--
-- SENGAJA bukan foreign key, alasan yang sama dengan bd_project_shops (0044):
-- shop bukan entitas tersendiri melainkan hasil pengelompokan kartu produk, jadi
-- tidak ada baris untuk direferensi. `deal_id` DIBIARKAN: slot lama yang menunjuk
-- brand_deals tetap sah.
alter table live_schedule_slots add column shop_key text;
create index live_schedule_slots_shop_key_idx on live_schedule_slots (shop_key);

comment on column live_schedule_slots.shop_key is
  'Shop dari tabel "Shop dari Produk TAP" (= products_tap.shop_key). Bukan FK: shop adalah hasil grouping kartu produk. Dipakai notifikasi PIC TAP di sidebar (slot brand yang PIC TAP-nya akun tersebut).';

-- Deal Brand → tabel "Shop dari Produk TAP": kunci grup shop jadi kolom nyata.
--
-- Tabel shop di tab Deal Brand kini punya tombol Edit: mengisi Shop ID di satu
-- baris shop harus mengisi Shop ID SELURUH kartu produk shop itu di tab Produk
-- TAP (begitu pula saat tipe campaign-nya diubah). Untuk itu server harus bisa
-- MENGAMBIL persis baris-baris yang membentuk satu baris ringkasan.
--
-- Sebelumnya kunci grup hanya hidup sebagai ekspresi di dalam view, jadi satu-
-- satunya cara memilih anggotanya adalah menyalin ekspresi itu ke filter PostgREST
-- — dua salinan aturan yang bisa berbeda diam-diam (CLAUDE.md #4). Ekspresinya
-- dipindah jadi generated column `shop_key`, lalu view membacanya. Satu definisi,
-- dipakai view untuk mengelompokkan dan server action untuk memilih anggota grup.
--
-- Stored generated column: nilainya ikut berubah sendiri saat shop_name/shop_id
-- di-update, jadi baris yang shop-nya dibetulkan otomatis pindah grup.

alter table products_tap
  -- Baris tanpa nama shop TIDAK dilebur jadi satu baris palsu: ia jatuh ke
  -- shop_id-nya sendiri, dan baru ke '(tanpa shop)' kalau keduanya memang kosong.
  add column shop_key text generated always as (
    coalesce(nullif(btrim(shop_name), ''), '#' || shop_id, '(tanpa shop)')
  ) stored;

comment on column products_tap.shop_key is
  'Kunci grup shop (Shop Name → #shop_id → "(tanpa shop)"). Dipakai view products_tap_shop_summary untuk mengelompokkan dan form Edit shop di tab Deal Brand untuk memilih anggota grup.';

create index products_tap_shop_key_idx on products_tap (shop_key);

-- View dibuat ulang agar mengelompokkan lewat kolom di atas, plus dua hitungan
-- baru yang dibutuhkan form Edit: berapa kartu yang Ads Budget / Service Fee-nya
-- masih kosong. Tanpa itu form tidak tahu apakah pindah ke Paid Campaign akan
-- melanggar aturan "paid wajib punya kedua nominal" sebelum tombol Simpan ditekan.
drop view products_tap_shop_summary;

create view products_tap_shop_summary
with (security_invoker = on) as
select
  p.shop_key,
  max(nullif(btrim(p.shop_name), '')) as shop_name,
  min(p.shop_id) as shop_id,
  count(distinct p.shop_id) as shop_id_count,
  -- Kartu yang Shop ID-nya masih kosong — persis yang diisi tombol Edit.
  count(*) filter (where p.shop_id is null) as shop_id_missing,

  count(*) as product_count,
  count(*) filter (where p.active) as active_count,
  count(*) filter (where p.needs_review) as needs_review_count,
  -- '-' = sentinel baris tanpa campaign (derive ingest mingguan), bukan campaign.
  count(distinct p.campaign_id) filter (where p.campaign_id <> '-') as campaign_count,
  array_remove(array_agg(distinct p.campaign_type), null) as campaign_types,
  array_remove(array_agg(distinct p.deal_by), null) as deal_by_ids,
  array_remove(array_agg(distinct p.pic_tap), null) as pic_tap_ids,

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

  -- Masa berlaku shop = rentang gabungan seluruh kartunya; effective_end terjauh
  -- yang jadi acuan "exp date" di tabel.
  min(p.effective_start) as effective_start,
  max(p.effective_end) as effective_end,
  max(p.last_seen) as last_seen
from products_tap p
group by p.shop_key;

comment on view products_tap_shop_summary is
  'Ringkasan products_tap per shop_key untuk tabel shop di tab Deal Brand. Nominal (ads budget, service fee, GMV) dijumlah; harga & rate komisi dirata-rata; campaign sentinel "-" tidak dihitung sebagai campaign. Kolom *_missing = jumlah kartu yang kolomnya masih kosong, dipakai form Edit shop.';

grant select on products_tap_shop_summary to authenticated;

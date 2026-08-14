-- Deal Brand: ringkasan kartu Produk TAP per SHOP.
--
-- Tab "Deal Brand" menampilkan brand_deals (master deal lama). Deal BARU tidak
-- lagi masuk ke sana melainkan jadi kartu produk di products_tap (0041), jadi tab
-- itu kehilangan pandangan atas deal yang sedang berjalan. View ini mengembalikannya:
-- isi tabel Produk TAP DIRINGKAS per Shop Name, satu baris per shop — bentuk yang
-- sejajar dengan baris brand_deals (1 brand/shop = 1 baris) sehingga bisa dibaca
-- berdampingan dengan tabel deal lama.
--
-- Agregasinya SQL, bukan JavaScript: menarik seluruh katalog ke server Next hanya
-- untuk dijumlah adalah pola yang dilarang CLAUDE.md (pipeline berat = SQL/Edge
-- Function). Deterministik penuh, 0 LLM.
--
-- security_invoker: view mewarisi RLS products_tap (0019) — select untuk
-- authenticated, creator_user tetap ditolak lewat policy restriktifnya.

create view products_tap_shop_summary
with (security_invoker = on) as
select
  -- Kunci grup = Shop Name. Baris tanpa nama shop TIDAK dilebur jadi satu baris
  -- palsu: ia jatuh ke shop_id-nya sendiri, dan baru ke '(tanpa shop)' kalau
  -- keduanya memang kosong.
  coalesce(nullif(btrim(p.shop_name), ''), '#' || p.shop_id, '(tanpa shop)') as shop_key,
  max(nullif(btrim(p.shop_name), '')) as shop_name,
  min(p.shop_id) as shop_id,
  count(distinct p.shop_id) as shop_id_count,

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
group by 1;

comment on view products_tap_shop_summary is
  'Ringkasan products_tap per Shop Name untuk tabel shop di tab Deal Brand. Nominal (ads budget, service fee, GMV) dijumlah; harga & rate komisi dirata-rata; campaign sentinel "-" tidak dihitung sebagai campaign.';

grant select on products_tap_shop_summary to authenticated;

-- Ads Budget & Service Fee kini wajib untuk PAID CAMPAIGN, bukan komisi extra
-- (keputusan user 2026-08-14): paid = satu-satunya tipe berbayar, jadi kedua angka
-- itu memang selalu ada saat dealnya ditutup. Aturannya ditegakkan aplikasi
-- (productCardIssues) di dua jalur tulis: Registrasi Deal & form Edit Produk TAP.
comment on column products_tap.ads_budget is
  'Ads budget (Rp murni). Wajib saat campaign_type = paid.';
comment on column products_tap.service_fee is
  'Service fee (Rp murni). Wajib saat campaign_type = paid.';

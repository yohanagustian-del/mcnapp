-- Produk TAP: dua rate komisi "Shop Ads" dari export TAP Creator Matchmaking
-- ("Export Link" pada room campaign → Approved → Products).
--
-- Export itu membawa EMPAT rate komisi per produk, bukan dua:
--   Creator commission rate                      → commission_pct        (sudah ada)
--   Affiliate partner commission rate            → partner_commission_pct (sudah ada)
--   Creator Shop Ads commission rate             → kolom baru di sini
--   Affiliate partner Shop Ads commission rate   → kolom baru di sini
--
-- Rate Shop Ads berlaku saat penjualan datang lewat Shop Ads, jadi nilainya
-- berbeda dari rate afiliasi biasa dan tidak boleh ditimpakan ke kolom yang ada
-- (CLAUDE.md #4: satu sumber kebenaran per angka). Persen, bukan nominal.
alter table products_tap
  add column creator_shop_ads_commission_pct numeric,
  add column partner_shop_ads_commission_pct numeric;

comment on column products_tap.creator_shop_ads_commission_pct is
  'Rate komisi KREATOR untuk penjualan via Shop Ads (persen), dari kolom "Creator Shop Ads commission rate".';
comment on column products_tap.partner_shop_ads_commission_pct is
  'Rate komisi PARTNER/agency untuk penjualan via Shop Ads (persen), dari kolom "Affiliate partner Shop Ads commission rate".';

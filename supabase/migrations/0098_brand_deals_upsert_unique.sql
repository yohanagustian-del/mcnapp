-- ============================================================
-- 0098_brand_deals_upsert_unique.sql
-- JALANKAN SETELAH import Bulk Deal Brand selesai dan data bersih (keputusan user
-- 2026-10-20 #4). Sebelum itu duplikat persis masih mungkin ada di produksi dan
-- index ini akan gagal dibuat.
--
-- Kunci = (platform, shop_id, brand_name) persis, case-sensitive: "Cottonela.idn" dan
-- "cottonella.idn" tetap dua brand; satu shop_id boleh dipakai beberapa brand.
-- brand_name sudah di-trim oleh importer. Baris tanpa shop_id dan baris yang sudah
-- di-soft-deactivate tidak ikut.
-- Cek sebelum menjalankan:
--   select platform, shop_id, brand_name, count(*) from brand_deals
--   where shop_id is not null and deactivated_at is null
--   group by 1, 2, 3 having count(*) > 1;
-- ============================================================

create unique index if not exists brand_deals_platform_shop_brand_uniq
  on brand_deals (platform, shop_id, brand_name)
  where shop_id is not null and deactivated_at is null;

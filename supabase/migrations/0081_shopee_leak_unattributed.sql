-- SUSULAN DRIFT (lihat 0078 untuk konteks lengkap): perluasan leak_week_summary
-- untuk kasus kebocoran Shopee yang shop-nya TIDAK BISA diatribusi (tidak match ke
-- shop mana pun di master), diterapkan langsung ke staging & production 2026-09-26
-- sebagai "shopee_leak_unattributed" tanpa file repo. Butuh 0078 (pola kolom
-- `platform` tiktok/shopee).
--
-- gmv_unattributed = potensi bocor yang shop_id-nya tidak ditemukan sama sekali di
-- cooperating_shops (beda dari gmv_leak_potential biasa, yang basisnya shop YANG
-- DIKENAL tapi non-deal — lihat CLAUDE.md #4 M4 "Non-deal → LEAD"). Dipisah supaya
-- report tidak diam-diam menjumlah dua hal yang beda: satu peluang BD (shop belum
-- di TAP), satu lagi shop yang datanya sendiri belum lengkap/tidak match.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='leak_week_summary' and column_name='platform') then
    alter table leak_week_summary add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='leak_week_summary'
                   and column_name='gmv_leak_potential_shop_basis') then
    alter table leak_week_summary add column gmv_leak_potential_shop_basis numeric;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='leak_week_summary'
                   and column_name='gmv_unattributed') then
    alter table leak_week_summary add column gmv_unattributed numeric;
  end if;
end $$;

-- Uniqueness lama (week, uploaded_by) tidak cukup begitu satu uploader bisa
-- mengunggah ringkasan dua platform pada minggu yang sama.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'leak_week_summary_week_uploaded_by_key'
             and conrelid = 'leak_week_summary'::regclass) then
    alter table leak_week_summary drop constraint leak_week_summary_week_uploaded_by_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leak_week_summary_platform_week_uploaded_by_key'
                 and conrelid = 'leak_week_summary'::regclass) then
    alter table leak_week_summary add constraint leak_week_summary_platform_week_uploaded_by_key
      unique (platform, week, uploaded_by);
  end if;
end $$;

create index if not exists leak_week_summary_platform_idx on leak_week_summary (platform, week);

comment on column leak_week_summary.gmv_leak_potential_shop_basis is
  'Potensi bocor dihitung dari basis shop yang diketahui (sama semantik dengan gmv_leak_potential, dipisah untuk arus data Shopee) — beda dari gmv_unattributed.';
comment on column leak_week_summary.gmv_unattributed is
  'Potensi bocor pada shop yang TIDAK ditemukan di master shop (cooperating_shops) — bukan peluang BD biasa (shop dikenal tapi belum ber-deal), tapi data yang belum bisa diatribusi ke shop mana pun. Jangan dijumlah begitu saja dengan gmv_leak_potential/gmv_leak_potential_shop_basis (CLAUDE.md #4: dua hal yang beda).';

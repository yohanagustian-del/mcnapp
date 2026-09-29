-- SUSULAN DRIFT (pola sama dengan 0049_creator_master_gate.sql): dimensi `platform`
-- untuk pipeline ingest Shopee (kerja mengintegrasikan data Shopee per-kreator, lihat
-- juga PLAN_MSDPS Fase 1B) pernah diterapkan LANGSUNG ke staging & production
-- 2026-09-26 (dicatat riwayat Supabase sebagai "shopee_platform_dimension") tanpa
-- pernah ditulis sebagai file di repo. File ini + 4 berikutnya (0079-0082) menutup
-- lubang itu supaya environment baru yang dibangun dari folder ini tidak kehilangan
-- objeknya. Nomornya menyusul di belakang (bukan 0071-0075, yang sudah dipakai untuk
-- migrasi lain di repo ini pada saat drift terjadi) — kronologi asli ada di komentar
-- masing-masing file, bukan di nomor filenya.
--
-- SETIAP PERNYATAAN DIBUAT AMAN DIJALANKAN ULANG: staging & production sudah
-- memuat objek ini, jadi replay harus jadi no-op, bukan error.
--
-- Kenapa dimensi ini perlu: tabel-tabel inti M2/M4/M10 di bawah selama ini implisit
-- TikTok-only (satu shop_id/creator hanya berarti satu hal). Data Shopee memakai
-- ruang ID yang sama sekali terpisah, jadi setiap baris perlu tahu platform-nya
-- sendiri sebelum data dua platform bisa hidup berdampingan di tabel yang sama.
-- Default 'tiktok' menjaga baris lama tetap berarti persis seperti sebelumnya.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='bd_leads' and column_name='platform') then
    alter table bd_leads add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='brand_deals' and column_name='platform') then
    alter table brand_deals add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='cooperating_shops' and column_name='platform') then
    alter table cooperating_shops add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='creator_link_status' and column_name='platform') then
    alter table creator_link_status add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='creator_period_summary' and column_name='platform') then
    alter table creator_period_summary add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='creator_subcat_segment_gmv' and column_name='platform') then
    alter table creator_subcat_segment_gmv add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='creator_top_products' and column_name='platform') then
    alter table creator_top_products add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='products_tap' and column_name='platform') then
    alter table products_tap add column platform text not null default 'tiktok'
      check (platform in ('tiktok', 'shopee'));
  end if;
end $$;

-- creators.platform sudah ada sejak 0049 (nullable, tanpa default) — data Shopee
-- butuh baris BARU otomatis berarti 'tiktok' juga, sama seperti tabel di atas.
alter table creators alter column platform set default 'tiktok';

-- ============ cooperating_shops: shop_id Shopee & TikTok berbagi ruang angka ============
-- PK lama (shop_id saja) akan menabrakkan shop TikTok dan shop Shopee yang kebetulan
-- bernomor sama. Kunci identitas shop sekarang (platform, shop_id).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'cooperating_shops_pkey'
             and conrelid = 'cooperating_shops'::regclass
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (shop_id)') then
    alter table cooperating_shops drop constraint cooperating_shops_pkey;
    alter table cooperating_shops add constraint cooperating_shops_pkey primary key (platform, shop_id);
  end if;
end $$;

-- ============ Index platform-aware untuk query filter-per-platform ============
create unique index if not exists bd_leads_platform_shop_uniq on bd_leads (platform, shop_id);
create index if not exists creator_link_status_platform_idx on creator_link_status (platform, creator_id, week);
create index if not exists creator_period_summary_platform_idx on creator_period_summary (platform, creator_id, period_start);
create index if not exists creator_subcat_segment_gmv_platform_idx on creator_subcat_segment_gmv (platform, window_end);
create index if not exists creator_top_products_platform_idx on creator_top_products (platform, creator_id, period_start);
create index if not exists products_tap_platform_name_idx on products_tap (platform, lower(product_name));
create index if not exists creators_platform_uid_idx on creators (platform, uid);

comment on column products_tap.platform is 'tiktok | shopee — dimensi platform (SUSULAN DRIFT 2026-09-26, lihat 0078). Default tiktok menjaga baris lama tetap berarti seperti sebelumnya.';
comment on column brand_deals.platform is 'tiktok | shopee — lihat products_tap.platform.';
comment on column cooperating_shops.platform is 'tiktok | shopee — bagian dari primary key (platform, shop_id) sejak migrasi ini: shop_id Shopee & TikTok berbagi ruang angka yang sama.';

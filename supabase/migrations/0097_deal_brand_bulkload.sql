-- ============================================================
-- 0097_deal_brand_bulkload.sql
-- Bulk load Deal Brand dari sheet "All Brand TAP [Database Bizdev TikTok 2026]"
-- tab "DATA BULKING! UNTUK KO YOHAN" + role Campaign Ops (keputusan user 2026-10-20,
-- docs/DECISIONS.md D-2026-10-20-*).
--
-- Isi (semua di sistem yang SUDAH ADA — tidak ada tabel baru):
--   1. brand_deals.status: enum baru reguler | running_1st_month | retention | hold | stop.
--      Pemetaan nilai lama: running → running_1st_month, hold → hold, done → stop.
--   2. brand_deals kolom baru: support_types text[], working_sheet text,
--      campaign_ops_id (FK team_members), bizdev_label (teks asli kolom "Bizdev" sheet,
--      mis. "Non BD Hande" — penanda, BUKAN member), deactivated_at (soft-deactivate
--      untuk langkah Replace; baris yang masih direferensikan FK tidak di-hard-delete).
--   3. brand_deals.ads_brand → DEPRECATED (read-only, nilai mentah sheet). Ads support
--      pindah ke bd_project_shops.ads_support (per project × shop).
--   4. Index non-unik kunci upsert (platform, shop_id, brand_name). Unique index
--      parsial-nya ada di 0098 dan baru dijalankan SETELAH import bersih.
--   5. app_config: pilihan status, ads support, leads, niche (niche bisa ditambah lewat
--      UI oleh management/bizdev_lead).
--
-- Tanpa DROP POLICY/TRIGGER (K23). Satu-satunya drop = constraint status (perlu diganti).
-- ============================================================

-- ============ 1. Status enum baru ============
alter table brand_deals drop constraint if exists brand_deals_status_check;

update brand_deals set status = 'running_1st_month' where status = 'running';
update brand_deals set status = 'stop' where status = 'done';
-- 'hold' tetap 'hold'.

alter table brand_deals
  add constraint brand_deals_status_check
  check (status in ('reguler', 'running_1st_month', 'retention', 'hold', 'stop'));

-- ============ 2. Kolom baru brand_deals ============
alter table brand_deals
  add column if not exists support_types text[],
  add column if not exists working_sheet text,
  add column if not exists campaign_ops_id uuid references team_members(id),
  add column if not exists bizdev_label text,
  add column if not exists deactivated_at timestamptz;

alter table brand_deals drop constraint if exists brand_deals_support_types_check;
alter table brand_deals
  add constraint brand_deals_support_types_check
  check (support_types is null or support_types <@ array['sample', 'flash_sale', 'ads']::text[]);

comment on column brand_deals.support_types is
  'Sample/Flash Sale/Ads yang didukung brand; dinormalisasi & diurutkan (sample, flash_sale, ads).';
comment on column brand_deals.campaign_ops_id is
  'Campaign Ops penanggung jawab administratif brand (kolom "Campaign Ops" sheet). "Non Campaign Ops" = NULL.';
comment on column brand_deals.bizdev_label is
  'Teks asli kolom "Bizdev" sheet (mis. "Non BD Hande"). Penanda saja; penanggung jawab = brand_bizdev_handlers.';
comment on column brand_deals.deactivated_at is
  'Soft-deactivate saat Replace: baris produksi yang tidak ada di sheet tapi masih direferensikan FK.';
comment on column brand_deals.ads_brand is
  'DEPRECATED sejak 0097: nilai mentah Ads Brand dari sheet, read-only. Ads support = bd_project_shops.ads_support.';

create index if not exists brand_deals_upsert_key_idx
  on brand_deals (platform, shop_id, brand_name);
create index if not exists brand_deals_campaign_ops_idx on brand_deals (campaign_ops_id);

-- ============ 3. Ads support per (project × shop) ============
-- Per relasi project–shop, bukan per project: satu Project BD bisa menggabungkan
-- beberapa brand dengan skema ads berbeda (sheet menyimpannya per brand).
alter table bd_project_shops add column if not exists ads_support text;
comment on column bd_project_shops.ads_support is
  'Skema dukungan ads brand di project ini; nilai dari app_config m8.ads_support_options.';

-- ============ 4. app_config pilihan ============
insert into app_config (key, value) values
  ('m8.deal_status_options', '[
    {"value": "reguler", "label": "Reguler"},
    {"value": "running_1st_month", "label": "Running Bulan Pertama"},
    {"value": "retention", "label": "Retention"},
    {"value": "hold", "label": "Hold"},
    {"value": "stop", "label": "Stop"}
  ]'::jsonb),
  ('m8.ads_support_options', '[
    "Brand Barcode Bulking - Cek BD",
    "Brand Invoice Bulking - Cek BD",
    "Brand Invoice One Time - Cek BD",
    "Ads By Brand - Minta Barcode",
    "Transfer Daily by Brand",
    "Tidak Support Ads"
  ]'::jsonb),
  ('m8.leads_type_options', '[
    "Internal TAP", "Celebrity", "China", "Minishowcase", "Matchmaking",
    "Campaign Internal (A&S)", "Affiliate Academy", "Internal ABP", "Scouting"
  ]'::jsonb),
  ('m8.niche_options', '[
    "Automotive & Motorcycle", "Baby & Maternity", "Beauty & Personal Care",
    "Books, Magazines & Audio", "Computers & Office Equipment", "Fashion",
    "Fashion Accessories", "Food & Beverages", "Fragrance", "Furniture", "Health",
    "Home & Living", "Home Improvement", "Home Supplies", "Household Appliances",
    "Kids'' Fashion", "Kitchenware", "Lifestyle", "Luggage & Bags",
    "Menswear & Underwear", "Mom & baby", "Muslim Fashion", "Personal care",
    "Pet Supplies", "Phones & Electronics", "Shoes", "Sports & Outdoor",
    "Textiles & Soft Furnishings", "Tools & Hardware", "Toys & Hobbies", "Women Bag",
    "Womenswear & Underwear"
  ]'::jsonb)
on conflict (key) do nothing;

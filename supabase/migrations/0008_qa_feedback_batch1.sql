-- QA feedback batch 1 (browser QA 2026-07-04)
-- Covers: creators enrichment, deal products (1 brand → N produk), metrics upload
-- sources + CM upload log, project per-creator monitoring, sourcing flags
-- (CM self-sourced deal / BizDev direct creator), acquisition binding metrics +
-- quarterly GMV attribution, tool usage (adoption) logs.

-- ============ creators: top-3 niche, rate card, gmv live/video, platform ============
alter table creators
  add column if not exists top_niches text[],              -- top 3 kategori level-2 (urut GMV)
  add column if not exists rate_card numeric,              -- upload manual per creator; null = belum ada
  add column if not exists gmv_live numeric default 0,     -- agregat dari platform_metrics_raw / M4
  add column if not exists gmv_video numeric default 0,
  add column if not exists platform text check (platform in ('tiktok','shopee'));
-- durasi sisa kontrak = computed di UI dari contract_end_date (tidak disimpan).

-- ============ deal_products: 1 brand mendaftarkan banyak produk ============
create table if not exists deal_products (
  id bigserial primary key,
  deal_id text references brand_deals(id) not null,
  product_id text,                                         -- ID produk platform
  product_name text not null,
  product_link text,
  niche text,                                              -- kategori level-2
  exp_date date,
  komisi_kreator_pct numeric,
  komisi_mea_pct numeric,
  ads_budget numeric,
  service_fee numeric,
  status text check (status in ('running','hold','done')) default 'running',
  created_by uuid references team_members(id),
  created_at timestamptz default now()
);
create index if not exists deal_products_deal on deal_products (deal_id);
create index if not exists deal_products_product on deal_products (product_id);
alter table deal_products enable row level security;
create policy deal_products_read on deal_products for select to authenticated using (true);
-- write via service role (server action + RBAC).

-- deal-level kolom baru untuk list /deals
alter table brand_deals
  add column if not exists ads_budget numeric,
  add column if not exists service_fee numeric,
  -- sourcing: deal didaftarkan BizDev (default) atau CM langsung tanpa BizDev
  add column if not exists sourced_by_role text check (sourced_by_role in ('bizdev','cm')) default 'bizdev',
  add column if not exists sourced_by uuid references team_members(id),
  -- campaign non-berbayar: sample & komisi extra (tidak ada nilai kontrak)
  add column if not exists campaign_type text
    check (campaign_type in ('paid','sample','extra_commission')) default 'paid';

-- ============ campaign_requests: BizDev sourcing creator langsung tanpa CM ============
alter table campaign_requests
  add column if not exists creator_sourced_by text
    check (creator_sourced_by in ('cm','bizdev')) default 'cm';

-- ============ metrics: sumber custom report + log upload per CM ============
create table if not exists metric_upload_batches (
  batch_id text primary key,                               -- = platform_metrics_raw.upload_batch
  source_type text not null check (source_type in
    ('mcn_tiktok_product',   -- custom report MCN tiktok (creator, produk, toko, kategori)
     'tap_tiktok_product',   -- custom report TAP tiktok (creator, produk, toko, kategori)
     'mcn_tiktok_live',      -- custom report MCN tiktok (creator, live)
     'tap_tiktok_live',      -- custom report TAP tiktok (creator, live)
     'shopee',               -- custom report shopee
     'sap')),                -- custom report sap
  file_name text,
  row_count int default 0,
  gmv_total numeric default 0,
  uploaded_by uuid references team_members(id) not null,   -- CM pengunggah (log wajib)
  uploaded_at timestamptz default now()
);
create index if not exists metric_batches_uploader on metric_upload_batches (uploaded_by, uploaded_at desc);
alter table metric_upload_batches enable row level security;
create policy metric_batches_read on metric_upload_batches for select to authenticated using (true);

alter table platform_metrics_raw
  add column if not exists report_source text;             -- = metric_upload_batches.source_type

-- ============ special projects: target kreator + performa per kreator ============
alter table special_projects
  add column if not exists target_creators int;            -- jumlah kreator dibutuhkan
alter table project_participants
  add column if not exists target_gmv numeric;             -- target kontribusi per kreator

create table if not exists project_creator_metrics (       -- monitor performa tiap kreator project
  project_id bigint references special_projects(id),
  creator_id text references creators(id),
  date date,
  gmv_actual numeric default 0,
  items_sold int default 0,
  primary key (project_id, creator_id, date)
);
alter table project_creator_metrics enable row level security;
create policy pcm_read on project_creator_metrics for select to authenticated using (true);

-- ============ acquisitions: komisi binding, GMV 30d (log), atribusi GMV quartal ============
alter table acquisitions
  add column if not exists commission_share_at_binding numeric,  -- komisi kreator saat closing binding
  add column if not exists gmv_last_30d numeric,                 -- GMV 30 hari terakhir saat binding (log-only)
  add column if not exists quarter_end date,                     -- akhir quartal berjalan saat binding
  add column if not exists gmv_quarter_actual numeric;           -- total GMV binding_date → quarter_end (batch, deterministik)
-- binding 20 Feb → quarter_end 31 Mar → gmv_quarter_actual = sum GMV 20 Feb..31 Mar.

-- ============ tool_usage_logs: adopsi sistem (jam/bulan per user) ============
create table if not exists tool_usage_logs (
  id bigserial primary key,
  member_id uuid references team_members(id) not null,
  path text not null,
  occurred_at timestamptz default now()
);
create index if not exists tool_usage_member_time on tool_usage_logs (member_id, occurred_at desc);
alter table tool_usage_logs enable row level security;
create policy tool_usage_read on tool_usage_logs for select to authenticated using (true);
-- insert page-view sendiri (bukan service role, supaya murah dari middleware/layout)
create policy tool_usage_insert_own on tool_usage_logs for insert to authenticated
  with check (member_id = auth.uid());
-- Agregasi jam: sessionize gap 30 menit (SQL window), sum durasi per member per bulan.

-- Module 0.5: Data Ingestion & Aggregation Pipeline (Shared) — Fase 0/1 schema.
-- Process-on-ingest, drop-raw: transactions_all/transactions_agency_link (existing,
-- reused as staging) are parsed once, aggregated in one pass into the tables below,
-- then the raw batch rows are deleted (gated by app_config retention.delete_raw_after_ingest,
-- already seeded in 0014_m12_retention.sql). 0 LLM in this path — pure ETL/SQL.
--
-- RLS follows the established baseline pattern in this codebase (0002/0004/0005):
-- "select to authenticated using (true)" for operational data tables, with app-level
-- scoping (role + owner_cpm_id) enforced in server actions/queries — see cpm_activity_select,
-- txall_select, metrics_select, matching_runs_select for precedent. Writes are service-role
-- only (pipeline runs via createAdminClient()); no user-facing insert/update/delete policy.

-- ============ creator_period_summary (M2, M8 consumer) ============
create table creator_period_summary (
  id bigserial primary key,
  creator_id text references creators(id) not null,
  period_start date not null,
  period_end date not null,
  upload_batch text not null,
  gmv_total numeric not null default 0,
  nmv numeric,
  affiliate_gmv numeric not null default 0,
  affiliate_live_gmv numeric not null default 0,
  affiliate_video_gmv numeric not null default 0,
  live_orders int not null default 0,
  video_orders int not null default 0,
  orders int not null default 0,
  items_sold int not null default 0,
  direct_gmv numeric not null default 0,
  refund_gmv numeric not null default 0,
  ctr numeric,
  ctor numeric,
  live_pct numeric,                          -- affiliate_live_gmv / affiliate_gmv (guard div-0 → null)
  created_at timestamptz default now()
);
create unique index creator_period_summary_uniq
  on creator_period_summary (creator_id, period_start, upload_batch);
create index on creator_period_summary (creator_id, period_start);
alter table creator_period_summary enable row level security;
create policy cps_select on creator_period_summary for select to authenticated using (true);
-- writes via service role only (ingest pipeline).

-- ============ creator_subcat_segment_gmv (M5, M6 consumer) ============
create table creator_subcat_segment_gmv (
  id bigserial primary key,
  creator_id text references creators(id) not null,
  level2_category text not null,
  price_segment price_segment_t,             -- null when items_sold=0 (avg_price undefined)
  upload_batch text not null,
  window_end date not null,
  gmv numeric not null default 0,
  live_gmv numeric not null default 0,
  items_sold int not null default 0,
  orders int not null default 0,
  avg_price numeric,                         -- gmv / items_sold (null guard div-0)
  created_at timestamptz default now()
);
create index on creator_subcat_segment_gmv (creator_id, level2_category, price_segment);
create index creator_subcat_segment_gmv_batch_idx on creator_subcat_segment_gmv (upload_batch);
alter table creator_subcat_segment_gmv enable row level security;
create policy cssg_select on creator_subcat_segment_gmv for select to authenticated using (true);

-- ============ creator_top_products (M2 consumer) ============
create table creator_top_products (
  id bigserial primary key,
  creator_id text references creators(id) not null,
  period_start date not null,
  period_end date not null,
  upload_batch text not null,
  rank int not null,
  product_id text not null,
  product_info text,
  shop_id text,
  level2_category text,
  gmv numeric not null default 0,
  orders int not null default 0,
  created_at timestamptz default now()
);
create index on creator_top_products (creator_id, period_start);
create index creator_top_products_batch_idx on creator_top_products (upload_batch);
alter table creator_top_products enable row level security;
create policy ctp_select on creator_top_products for select to authenticated using (true);

-- ============ upload_batches (audit/idempotency metadata; no raw rows stored) ============
create table upload_batches (
  batch_id text primary key,
  source_type text not null check (source_type in ('mcn', 'tap', 'master')),
  uploaded_by uuid references team_members(id),
  uploaded_at timestamptz default now(),
  row_count_raw int not null default 0,
  creators_count int not null default 0,
  period_start date,
  period_end date,
  file_hash text,
  status text not null default 'staging' check (status in ('staging', 'processed', 'failed')),
  processed_at timestamptz,
  error text
);
create index on upload_batches (source_type, status);
alter table upload_batches enable row level security;
create policy ub_select on upload_batches for select to authenticated using (true);
-- writes via service role only (runIngest orchestrator).

-- ============ Config seed (Module 0.5 §5) ============
insert into app_config(key, value) values
  ('ingest.top_n_products', '20'),
  ('ingest.staging_ttl_hours', '24')
on conflict (key) do nothing;
-- segments.price_bounds already seeded in 0005_phase2_tools.sql — reused, not duplicated.
-- retention.delete_raw_after_ingest already seeded in 0014_m12_retention.sql — reused as the
-- drop-raw gate for this pipeline (Module 0.5 §2.7).

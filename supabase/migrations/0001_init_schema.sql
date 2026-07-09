-- MCN MEA AI Platform — Initial Schema (M1–M8)
-- Run: supabase db push

-- ============ ENUMS ============
create type role_t as enum ('director','head','spv','cm_lead','cpm','bizdev_lead','bizdev','campaign_ops','bd_admin','acquisition_lead','acquisition_spec','campaign_external','creator_support','finance');
create type team_group_t as enum ('management','acquisition','cm','bizdev','external','support','finance');
create type platform_segment_t as enum ('tiktok','shopee','celeb');
create type creator_status_t as enum ('prospek','binding','aktif','nonaktif');
create type creator_segment_t as enum ('tc','incubation','celeb');
create type deal_model_t as enum ('bulk','endorsement','ads_cps','tapin','cps_only');
create type payment_terms_t as enum ('lunas','invoice');
create type payment_status_t as enum ('pending','partial','paid');
create type handover_t as enum ('bd','campaign_ops','cpm','creator','done');
create type link_status_t as enum ('via_agency','bocor_sebagian','bocor_total','belum_ada_link');
create type platform_t as enum ('tap','sap');
create type audit_type_t as enum ('auto','approval','platform_alert');
create type source_t as enum ('tap','sap','top_shop','organic','other');
create type price_segment_t as enum ('low','entry','sweet','high','premium');
create type report_period_t as enum ('weekly','monthly');
create type report_status_t as enum ('draft','final');
create type project_status_t as enum ('planning','aktif','selesai');
create type live_type_t as enum ('solo','cohost');
create type req_type_t as enum ('sample','ads','hsl');
create type req_status_t as enum ('diajukan','diproses','selesai');
create type cm_confirm_t as enum ('menunggu','mau','tidak');
create type brand_acc_t as enum ('n_a','menunggu','approved','ditolak');
create type campaign_final_t as enum ('proses','fix','batal');
create type esign_t as enum ('draft','sent','signed','expired');
create type lead_source_t as enum ('inbound','outbound','platform');
create type referral_source_t as enum ('antar_creator','platform');
create type okr_period_t as enum ('quartal','bulan');
create type aggregation_t as enum ('pribadi','tim','pribadi_tim');
create type gating_decision_t as enum ('pending','gugur','tidak_gugur');
create type lead_status_t as enum ('baru','diambil','deal');

-- ============ M1: AUTH & CORE ============
create table team_members (
  id uuid primary key references auth.users(id),
  name text not null, email text unique not null,
  role role_t not null, team_group team_group_t not null,
  platform_segment platform_segment_t,
  active bool default true, created_at timestamptz default now()
);

create table audit_logs (
  id bigserial primary key,
  actor_id uuid references team_members(id),
  action text not null, entity_type text not null, entity_id text,
  before jsonb, after jsonb, type audit_type_t not null,
  created_at timestamptz default now()
);
create index on audit_logs (entity_type, entity_id);

create table app_config ( key text primary key, value jsonb not null );
insert into app_config(key,value) values
  ('m2.delta_threshold','0.15'), ('m4.bocor_sebagian','0.10'), ('m4.bocor_total','0.50'),
  ('m7.live_active_min','65000000'), ('m8.perf_drop','0.15'), ('calendar.q3_cutoff','"2026-09-20"');

create table creators (
  id text primary key, name text not null, niche text, follower_tier text,
  level smallint check (level between 1 and 6), segment creator_segment_t,
  gmv numeric default 0, commission_share numeric, contract_end_date date,
  status creator_status_t default 'prospek',
  owner_cpm_id uuid references team_members(id), created_at timestamptz default now()
);
create index on creators (owner_cpm_id);
create index on creators (niche);

create table brand_deals (
  id text primary key,
  brand_name text not null,          -- WAJIB sesuai display platform
  shop_id text,                      -- join ke transaksi & cooperating_shops
  brand_link text, niche text,
  gmv_tap numeric, avg_price numeric,
  tim_handler text,
  pic_tap uuid references team_members(id),
  pic_abp uuid references team_members(id),
  ads_brand text,                    -- Campaign Bulking | Daily (Barcode/Invoicing) | ...
  bobot_abp smallint,
  leads_type text,                   -- Internal TAP | Celebrity | China | Matchmaking | ...
  bobot_leads text,                  -- B0 | B1 | B2
  diterima_ditolak text check (diterima_ditolak in ('diterima','ditolak')),
  priority text,                     -- P0 | P1 | P2
  status text check (status in ('running','hold','done')),
  bobot_status smallint,
  campaign_name text, campaign_id text,
  exp_date date,                     -- = deal_end (durasi deal)
  link_tap text, contact_pic_brand text, nama_grup text,
  komisi_kreator_raw text, komisi_kreator_pct numeric,  -- raw simpan "5-7%"; pct = parsed
  komisi_mea_raw text, komisi_mea_pct numeric,          -- rate MEA (untuk M5)
  openplan text, action text,        -- GMV value | Commission value
  notes text, shop_code text,
  -- field lama tetap untuk kompatibilitas modul lain:
  deal_model deal_model_t, payment_terms payment_terms_t,
  payment_status payment_status_t default 'pending',
  handover_status handover_t default 'bd', needs_brand_acc bool default false,
  deal_start date, deal_end date,    -- deal_end di-set = exp_date saat ingest
  created_by uuid references team_members(id), created_at timestamptz default now()
);
create index on brand_deals (shop_id);

create table agency_links ( -- READ-ONLY via engine M4
  id text primary key, creator_id text references creators(id) not null,
  shop_id text not null, product_ref text, platform platform_t,
  link_status link_status_t not null, source_upload_week date, computed_at timestamptz default now()
);
create index on agency_links (creator_id);

-- ============ M2: REPORT ============
create table platform_metrics_raw (
  id bigserial primary key, creator_id text references creators(id) not null,
  period date not null, metric text not null, value numeric,
  source source_t, sub_category text, price_segment price_segment_t,
  upload_batch text not null, fetched_at timestamptz default now(),
  unique (creator_id, period, metric, source, upload_batch)
);
create index on platform_metrics_raw (creator_id, period);
create index on platform_metrics_raw (sub_category, price_segment);

create table creator_reports (
  id bigserial primary key, creator_id text references creators(id) not null,
  period_type report_period_t not null, period_start date not null,
  data_json jsonb, insight_draft text, insight_final text,
  status report_status_t default 'draft', token_used int default 0,
  generated_by uuid references team_members(id), finalized_by uuid references team_members(id),
  generated_at timestamptz default now()
);

create table cpm_report_activity (
  id bigserial primary key, cpm_id uuid references team_members(id),
  creator_id text references creators(id), period_type report_period_t,
  has_insight bool, generated_at timestamptz default now()
);
create table token_baseline ( report_type report_period_t primary key, best_token int, updated_at timestamptz default now() );

-- ============ M4: LINK LEAKAGE ============
-- CATATAN: data platform = AGREGAT per (product_id, shop_id, period), BUKAN per-transaksi.
-- Join CSV-all vs CSV-agency-link pakai (product_id, shop_id). Bocor = selisih GMV.
-- File 1 creator = tanpa kolom creator; file multi-creator = ada creator_name → map ke creator_id.
create table transactions_all (      -- CSV-1: semua transaksi creator (agregat/produk/periode)
  id bigserial primary key, creator_id text references creators(id),
  creator_name text,                 -- ADA di file multi-creator; null di file 1-creator
  period_start date, period_end date,
  product_id text, product_info text, shop_id text, shop_name text,
  level1_category text, level2_category text,
  affiliate_gmv numeric, affiliate_live_gmv numeric, affiliate_video_gmv numeric,
  affiliate_orders int, items_sold int,
  video_views int, live_views int, live_streams int, videos int,  -- multi-creator report
  upload_batch text
);
create index on transactions_all (upload_batch, creator_id);
create index on transactions_all (product_id, shop_id);

create table transactions_agency_link ( -- CSV-2: subset via agency link (agregat/produk/periode)
  id bigserial primary key, creator_id text references creators(id),
  period_start date, period_end date,
  product_id text, shop_id text, shop_name text, level2_category text,
  affiliate_gmv numeric, affiliate_live_gmv numeric, affiliate_video_gmv numeric,
  est_partner_commission numeric, actual_partner_commission numeric,
  est_creator_commission numeric, actual_creator_commission numeric,
  upload_batch text
);
create index on transactions_agency_link (upload_batch, product_id, shop_id);

create table cooperating_shops (   -- master shop MEA (refresh mingguan dari platform).
  shop_id text primary key, shop_name text, level2_categories text,
  total_collaborated_creators bigint,
  deal_id text references brand_deals(id),
  deal_start date, deal_end date,   -- deal_end DIISI dari brand_deals.exp_date (master deal internal), bukan dari platform
  active_flag bool default true      -- computed: deal_end >= now (bila deal_end ada)
);
create table bd_leads (
  id bigserial primary key, shop_id text, frequency int, total_gmv numeric,
  priority_score numeric, first_seen_week date,
  source text check (source in ('auto_m4','manual_cm')), status lead_status_t default 'baru'
);

-- ============ M7: SPECIAL PROJECT ============
create table special_projects (
  id bigserial primary key, name text not null, type text,
  start_date date, end_date date, target_gmv numeric,
  daily_target_curve jsonb, ads_budget_cap numeric, status project_status_t default 'planning'
);
create table project_participants (
  project_id bigint references special_projects(id), creator_id text references creators(id),
  is_external bool, tiktok_binding_status text check (tiktok_binding_status in ('pending','bound')),
  live_type live_type_t, joined_at timestamptz default now(),
  primary key (project_id, creator_id)
);
create table project_manpower (
  project_id bigint references special_projects(id), member_id uuid references team_members(id),
  role text, involvement text, primary key (project_id, member_id)
);
create table project_daily_metrics (
  project_id bigint references special_projects(id), date date,
  gmv_actual numeric, ads_spend numeric, creator_commission numeric, mea_revenue numeric,
  primary key (project_id, date)
);

-- ============ M8: WORKSPACES ============
create table creator_requests (
  id bigserial primary key, creator_id text references creators(id), type req_type_t,
  target_brand text, status req_status_t default 'diajukan',
  requested_by uuid references team_members(id), created_at timestamptz default now()
);
create table campaign_requests (
  id bigserial primary key, deal_id text references brand_deals(id),
  creator_id text references creators(id), owner_cpm_id uuid references team_members(id),
  cm_confirm_status cm_confirm_t default 'menunggu', needs_brand_acc bool,
  brand_acc_status brand_acc_t default 'n_a', final_status campaign_final_t default 'proses',
  created_at timestamptz default now()
);
create table creator_contracts (
  id bigserial primary key, creator_id text references creators(id),
  segment creator_segment_t, contract_doc text, esign_status esign_t default 'draft',
  provider text, signed_at timestamptz
);
create table acquisitions (
  id bigserial primary key, creator_id text references creators(id),
  specialist_id uuid references team_members(id), lead_source lead_source_t,
  binding_date date, gmv_post_join numeric
);
create table referrals (
  id bigserial primary key, new_creator_id text references creators(id),
  referrer_creator_id text references creators(id), referral_source referral_source_t,
  commission_status text check (commission_status in ('pending','dibayar')) default 'pending'
);

-- ============ M3: OKR ============
create table reward_tiers (
  id bigserial primary key, role text, kr_achieved_count int, reward_amount numeric -- null=TBD
);
create table okr_key_results (
  id bigserial primary key, role text, segment text, objective_ref text,
  metric text, target numeric, period_type okr_period_t, period_start date,
  aggregation_rule aggregation_t, gating_rule jsonb, reward_tier_ref bigint references reward_tiers(id),
  set_by uuid references team_members(id)
);
create table okr_actuals (
  id bigserial primary key, kr_id bigint references okr_key_results(id),
  subject_id text, actual_value numeric, pct_progress numeric, achieved bool,
  computed_at timestamptz default now(), source_ref text
);
create table okr_snapshots (
  id bigserial primary key, period_start date, kind text check (kind in ('baseline','final')), payload jsonb
);
create table okr_gating_events (
  id bigserial primary key, kr_id bigint references okr_key_results(id), subject_id text,
  event_desc text, evidence_ref text, flagged_at timestamptz default now(),
  director_decision gating_decision_t default 'pending', decided_at timestamptz
);

-- ============ RLS (enable + skeleton; refine per role in app) ============
alter table team_members enable row level security;
alter table creators enable row level security;
alter table brand_deals enable row level security;
alter table agency_links enable row level security;
alter table creator_reports enable row level security;
-- NOTE: tambahkan policy per role. agency_links & commission_share: NO update policy (read-only).
-- Contoh baseline (authenticated read); ganti sesuai matrix RBAC di CLAUDE.md:
create policy read_auth on creators for select to authenticated using (true);
create policy read_auth_links on agency_links for select to authenticated using (true);
-- Sengaja TIDAK ada policy insert/update untuk agency_links dari user (hanya service role / engine M4).

-- Fase 3: M8 Team Workspaces (routing req campaign lintas-workspace, CM/BizDev/
-- Acquisition/External, e-sign TC/Celeb, brand report). M8 meng-surface sumber
-- M2/M4/M5/M6 — tidak menghitung ulang (CLAUDE.md #4).

-- ============ Config: tunables M8 (m8.perf_drop sudah ada dari 0001) ============
insert into app_config(key, value) values
  ('m8.upgrade_roas_min', '3'),            -- PRD M8 §6.5: ROAS tinggi + GMV tinggi → saran upgrade service (tunable)
  ('m8.upgrade_gmv_min', '500000000'),     -- ambang GMV brand utk saran upgrade (Rp, tunable)
  ('m8.gmv_post_join_days', '90')          -- PRD M8 §2C.1: GMV diukur 3 bulan setelah join (KR)
on conflict (key) do nothing;

-- ============ creators: ads budget cap per creator (PRD M8 §6.4) ============
-- "Ads cap diisi bersamaan database creator yang di-upload" — basis cek req ads.
alter table creators add column ads_budget_cap numeric;

-- ============ campaign_requests: routing lintas-workspace (PRD M8 §2E) ============
alter table campaign_requests add column requested_by uuid references team_members(id);
alter table campaign_requests add column notes text;
alter table campaign_requests add column handed_over_at timestamptz;  -- fix → handover Campaign Ops
alter table campaign_requests add column updated_at timestamptz default now();
create index on campaign_requests (owner_cpm_id, final_status);
create index on campaign_requests (deal_id);

-- ============ creator_requests: sample/ads/HSL + gate approval ads cap (PRD M8 §2A.4, §6.4) ============
alter table creator_requests add column amount numeric;               -- nominal req ads (cek vs creators.ads_budget_cap)
alter table creator_requests add column notes text;
alter table creator_requests add column processed_by uuid references team_members(id);
-- Req ads melewati cap = berpotensi merugikan → approval Director (CLAUDE.md #2, bukan alert).
alter table creator_requests add column approval_status text
  check (approval_status in ('n_a','menunggu','approved','ditolak')) default 'n_a';
alter table creator_requests add column approved_by uuid references team_members(id);
alter table creator_requests add column updated_at timestamptz default now();
create index on creator_requests (status);
create index on creator_requests (creator_id);

-- ============ creator_contracts: alur e-sign TC/Celeb (PRD M8 §2A.7) ============
alter table creator_contracts add column created_by uuid references team_members(id);
alter table creator_contracts add column sent_at timestamptz;
alter table creator_contracts add column expires_at date;
alter table creator_contracts add column notes text;
alter table creator_contracts add column created_at timestamptz default now();

-- ============ acquisitions & referrals (PRD M8 §2C) ============
alter table acquisitions add column handoff_done bool default false;  -- §2C.3 handoff ke CM
alter table acquisitions add column notes text;
alter table acquisitions add column created_at timestamptz default now();
create index on acquisitions (specialist_id);
create index on acquisitions (lead_source);

alter table referrals add column commission_amount numeric;           -- komisi perujuk (program ajak teman)
alter table referrals add column recorded_by uuid references team_members(id);
alter table referrals add column notes text;
alter table referrals add column created_at timestamptz default now();

-- ============ brand_deals: tahap pipeline BizDev (PRD M8 §2B.2) ============
alter table brand_deals add column pipeline_stage text
  check (pipeline_stage in ('prospek','nego','closing','aktif','selesai'));

-- ============ External Creator Workspace: log approach (PRD M8 §2D.1) ============
-- Success rate = deal pakai link TAP / total approach; GMV via creators/agency_links (M4).
create table external_approaches (
  id bigserial primary key,
  creator_name text not null,
  creator_id text references creators(id),           -- diisi saat creator ter-register
  approached_by uuid references team_members(id),
  approach_date date default current_date,
  status text not null check (status in ('approach','pakai_link','batal')) default 'approach',
  notes text,
  created_at timestamptz default now()
);
create index on external_approaches (status);
alter table external_approaches enable row level security;
create policy ext_approach_select on external_approaches for select to authenticated using (true);
-- write via service role (server action + RBAC m8.external).

-- ============ Brand report (PRD M8 §2B.4) — pola M2: data layer + 1 LLM call opsional ============
create table brand_reports (
  id bigserial primary key,
  deal_id text references brand_deals(id) not null,
  period_start date not null,
  period_end date not null,                          -- exclusive
  data_json jsonb not null,                          -- agregat deterministik (GMV, ROAS bila ads diisi, video, view)
  summary_text text,                                 -- ringkasan naratif LLM (opsional)
  token_used int default 0,
  generated_by uuid references team_members(id),
  created_at timestamptz default now()
);
create index on brand_reports (deal_id, period_start);
alter table brand_reports enable row level security;
create policy brand_reports_select on brand_reports for select to authenticated using (true);

-- ============ platform_alerts: tipe alert M8 (performa creator turun — event, bukan approval) ============
alter table platform_alerts drop constraint platform_alerts_alert_type_check;
alter table platform_alerts add constraint platform_alerts_alert_type_check check (alert_type in
  ('link_bocor','deal_expiring','deal_expired','commission_drop','token_regression',
   'project_rugi','project_over_cap','perf_drop'));

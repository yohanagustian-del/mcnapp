-- Fase 2: Tools rule-based (projectGmv shared + M5 Matching + M6 Predictor + M7 Special Project)

-- ============ Config: tunables Fase 2 (semua threshold via app_config, tidak hardcoded) ============
insert into app_config(key, value) values
  ('projection.window_days', '28'),                                            -- window rolling basis proyeksi (M5/M6, LOCKED 28 hari)
  ('projection.spread', '0.25'),                                               -- range proyeksi = basis ± spread
  ('projection.level_factors', '{"1":0.85,"2":0.95,"3":1.0,"4":1.05,"5":1.15,"6":1.25}'),
  ('segments.price_bounds', '{"low":180000,"entry":800000,"sweet":3600000,"high":8000000}'), -- PRD M5 §2.1.1 (shared M5/M6)
  ('m5.rank_weights', '{"gmv":1,"conversion":1,"level_format":1,"commission":1}'),           -- bobot default SEIMBANG (tunable)
  ('m6.min_relevant_creators', '5'),                                           -- di bawah ini → tampilkan fallback segmen lain
  ('m7.status_tolerance', '0.05')                                              -- ± band on-track vs kurva target
on conflict (key) do nothing;

-- ============ M5: log run matching (PRD §6.6 — ukur efektivitas & baseline "SKU lain") ============
create table matching_runs (
  id bigserial primary key,
  creator_id text references creators(id) not null,
  run_by uuid references team_members(id),
  window_start date,
  params jsonb,
  results jsonb,                       -- saran ter-ranking (top-N) yang ditampilkan ke CPM
  created_at timestamptz default now()
);
create index on matching_runs (creator_id, created_at);
alter table matching_runs enable row level security;
create policy matching_runs_select on matching_runs for select to authenticated using (true);
-- write hanya via service role (engine/server action).

-- ============ M6: log proyeksi deal (skenario BD; tanpa komisi MEA di hasil) ============
create table deal_projections (
  id bigserial primary key,
  run_by uuid references team_members(id),
  input jsonb not null,                -- {sub_category, price, segment, duration_days, window_start}
  result jsonb not null,               -- {total_min, total_max, relevant, fallback}
  created_at timestamptz default now()
);
alter table deal_projections enable row level security;
create policy deal_projections_select on deal_projections for select to authenticated using (true);

-- ============ M7: kolom tambahan + RLS ============
alter table special_projects add column created_by uuid references team_members(id);
alter table special_projects add column result_summary jsonb;   -- diisi saat penutupan (PRD §2.6)

alter table special_projects enable row level security;
alter table project_participants enable row level security;
alter table project_manpower enable row level security;
alter table project_daily_metrics enable row level security;
create policy sp_select on special_projects for select to authenticated using (true);
create policy pp_select on project_participants for select to authenticated using (true);
create policy pm_select on project_manpower for select to authenticated using (true);
create policy pdm_select on project_daily_metrics for select to authenticated using (true);
-- mutasi via service role + RBAC server action (m7.manage / m7.metrics).

-- ============ platform_alerts: tipe alert M7 (anti-rugi & over-cap, event bukan approval) ============
alter table platform_alerts drop constraint platform_alerts_alert_type_check;
alter table platform_alerts add constraint platform_alerts_alert_type_check check (alert_type in
  ('link_bocor','deal_expiring','deal_expired','commission_drop','token_regression',
   'project_rugi','project_over_cap'));

-- ============ transactions_all: window scan untuk mesin proyeksi (M5/M6) ============
create index on transactions_all (period_start);

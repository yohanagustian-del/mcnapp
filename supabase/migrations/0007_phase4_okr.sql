-- Fase 4: M3 OKR & Performance Tracking
-- Meng-agregasi data dari M2/M4/M7/M8 — read-only pada sumber, tulis ke tabel OKR sendiri.

-- ============ Config kalender & OKR ============
insert into app_config(key, value) values
  ('calendar.q3_start',       '"2026-07-01"'),  -- awal Q3 (isi Director tiap quartal)
  ('calendar.q3_end',         '"2026-09-30"'),  -- akhir Q3
  ('m3.hands_on_window_days', '7')              -- window analisis hands-on ratio CPM
on conflict (key) do nothing;

-- ============ okr_key_results: tambah kolom period_end & filter_json ============
alter table okr_key_results
  add column if not exists period_end date,           -- akhir periode (inklusif)
  add column if not exists filter_json jsonb,         -- filter tambahan per metrik (niche, threshold, dll)
  add column if not exists active bool default true,  -- nonaktif = tidak di-score
  add column if not exists updated_at timestamptz default now();

-- ============ reward_tiers: tambah periode & keterangan ============
alter table reward_tiers
  add column if not exists period_start date,
  add column if not exists notes text;  -- penjelasan (TBD = belum ditetapkan Director)

-- ============ okr_actuals: index untuk query latest-per-subject ============
create index if not exists okr_actuals_latest
  on okr_actuals (kr_id, subject_id, computed_at desc);

-- ============ okr_gating_events: index ============
create index if not exists okr_gating_pending
  on okr_gating_events (director_decision, flagged_at desc);

-- ============ RLS: OKR tables (read authenticated; write service-role/Director only) ============
alter table okr_key_results      enable row level security;
alter table okr_actuals          enable row level security;
alter table okr_snapshots        enable row level security;
alter table okr_gating_events    enable row level security;
alter table reward_tiers         enable row level security;

-- Semua authenticated users boleh baca (server action enforce scope per role)
create policy okr_kr_read       on okr_key_results    for select to authenticated using (true);
create policy okr_actuals_read  on okr_actuals         for select to authenticated using (true);
create policy okr_snap_read     on okr_snapshots       for select to authenticated using (true);
create policy okr_gating_read   on okr_gating_events   for select to authenticated using (true);
create policy reward_tiers_read on reward_tiers         for select to authenticated using (true);
-- Mutasi hanya via service role (server action pakai admin client).

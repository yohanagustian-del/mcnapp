-- ============================================================
-- 0014_m12_retention.sql  (draft 0011 → renumbered; corrected to real schema)
-- Module 12: Data Retention & Maintenance — ADDITIVE part (safe to apply directly).
--
-- Two-stage model:
--   Stage 1 (raw file post-ingest deletion) — handled at ingest (files are parsed in the server
--     action and not persisted as DB rows; metric_upload_batches tracks provenance). No purge here.
--   Stage 2 (prune recorded data > raw_window) — run_retention_purge() below (DELETE-based, works
--     on the current non-partitioned tables). Converting raw tables to PARTITIONED (DROP PARTITION)
--     is a separate DESTRUCTIVE migration (0015_m12_partitioning.sql) — NOT applied here.
--
-- Corrections vs README draft:
--   - audit_logs insert uses the real columns (actor_label/action/entity_type/type), not (actor,detail).
--   - purge NEVER touches identity/deal/agency_links/audit tables (only raw metric/transaction tables).
--   - window guard: refuses any cutoff inside the hard 28-day module window (M5/M6).
-- ============================================================

-- ---------- 1. Permanent monthly aggregate (trend survives purge) ----------
create table if not exists metrics_monthly_agg (
  creator_id  text not null references creators(id) on delete cascade,
  month       date not null,                 -- first day of month
  metric      text not null,
  source      text,
  value       numeric,
  primary key (creator_id, month, metric, source)
);
create index if not exists idx_mma_month on metrics_monthly_agg(month);
alter table metrics_monthly_agg enable row level security;
create policy mma_read_internal on metrics_monthly_agg
  for select using (not is_creator_user());     -- creators see own perf via creator_metrics_v
create policy mma_od_no_insert on metrics_monthly_agg as restrictive for insert with check (not is_od_viewer());
create policy mma_od_no_update on metrics_monthly_agg as restrictive for update using (not is_od_viewer());
create policy mma_od_no_delete on metrics_monthly_agg as restrictive for delete using (not is_od_viewer());

-- ---------- 2. Retention config ----------
insert into app_config (key, value) values
  ('retention.raw_window',             '"6 months"'::jsonb),  -- recorded data; >= module min window
  ('retention.delete_raw_after_ingest','true'::jsonb),        -- delete raw staging post-ingest
  ('retention.archive_before_purge',   'false'::jsonb),
  ('retention.audit_window',           '"24 months"'::jsonb),
  ('retention.min_window_days',        '28'::jsonb)           -- hard floor (M5/M6 need 28 days)
on conflict (key) do nothing;

-- ---------- 3. Config validation: raw_window >= module minimum ----------
create or replace function validate_retention_window(p_window_days int) returns void
language plpgsql set search_path = public, pg_temp as $$
declare floor_days int;
begin
  select coalesce((value #>> '{}')::int, 28) into floor_days from app_config where key = 'retention.min_window_days';
  floor_days := coalesce(floor_days, 28);
  if p_window_days < floor_days then
    raise exception 'raw_window (% hari) < minimum module (% hari). Ditolak — set minimal % hari.',
      p_window_days, floor_days, floor_days;
  end if;
end $$;

-- ---------- 4. Retention engine (idempotent; aggregate-then-purge; window guard) ----------
create or replace function run_retention_purge() returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  cutoff date;
  win text;
  n_metrics bigint := 0; n_txall bigint := 0; n_txagency bigint := 0;
begin
  select (value #>> '{}') into win from app_config where key = 'retention.raw_window';
  cutoff := (date_trunc('month', now()) - coalesce(win, '6 months')::interval)::date;

  -- Hard window guard: never prune inside the 28-day module window.
  if cutoff > (now() - interval '28 days')::date then
    raise exception 'cutoff (%) di dalam window module (28 hari) — batal demi keamanan data', cutoff;
  end if;

  -- Aggregate-then-purge: only delete a recorded row when its month is already in metrics_monthly_agg.
  with del as (
    delete from platform_metrics_raw m
    where m.period < cutoff
      and exists (select 1 from metrics_monthly_agg a
                  where a.month = date_trunc('month', m.period)::date and a.creator_id = m.creator_id)
    returning 1
  ) select count(*) into n_metrics from del;

  with del as (
    delete from transactions_all t
    where t.period_start < cutoff
      and exists (select 1 from metrics_monthly_agg a
                  where a.month = date_trunc('month', t.period_start)::date and a.creator_id = t.creator_id)
    returning 1
  ) select count(*) into n_txall from del;

  with del as (
    delete from transactions_agency_link t
    where t.period_start < cutoff
      and exists (select 1 from metrics_monthly_agg a
                  where a.month = date_trunc('month', t.period_start)::date and a.creator_id = t.creator_id)
    returning 1
  ) select count(*) into n_txagency from del;

  -- Identity/deal/agency_links/audit tables are NEVER referenced here.
  insert into audit_logs (actor_label, action, entity_type, entity_id, after, type)
  values ('system:retention', 'm12.purge_recorded', 'platform_metrics_raw', cutoff::text,
          jsonb_build_object('cutoff', cutoff, 'platform_metrics_raw', n_metrics,
                             'transactions_all', n_txall, 'transactions_agency_link', n_txagency),
          'auto');
end $$;

-- ---------- 5. DB health surface (admin dashboard, read-only) ----------
create or replace view db_table_health_v with (security_invoker = on) as
select
  c.relname                              as table_name,
  pg_total_relation_size(c.oid)          as total_bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  c.reltuples::bigint                    as approx_rows
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('platform_metrics_raw','transactions_all','transactions_agency_link','metrics_monthly_agg');

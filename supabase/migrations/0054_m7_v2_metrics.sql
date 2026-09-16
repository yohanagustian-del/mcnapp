-- ============================================================
-- 0054_m7_v2_metrics.sql
-- M7 v2 Special Project — Fase 0 / PR-03: upload-batch + per-creator-per-day
-- metric pipeline (K2/K7: SAP dicoret, tiktok_live_session ditambah), plus B5
-- (gmv_actual jadi GENERATED → tidak ada lagi input GMV manual, ditegakkan
-- SECARA STRUKTUR, bukan cuma di server action — CLAUDE.md #4).
-- Depends on 0052/0053.
-- ============================================================

-- ---------- 1. metric_upload_batches: project-scoped batches (§6.7, K7) ----------
alter table metric_upload_batches
  add column if not exists project_id bigint references special_projects(id),
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists file_hash text,
  add column if not exists status text not null default 'processed'
    check (status in ('processed', 'superseded', 'failed', 'rolled_back')),
  add column if not exists matched_count int,
  add column if not exists unmatched_count int,
  add column if not exists out_of_window_count int,
  add column if not exists unmatched_usernames jsonb,
  add column if not exists missing_columns jsonb,
  add column if not exists error text;

create unique index if not exists metric_batches_project_filehash
  on metric_upload_batches (project_id, file_hash) where project_id is not null;

-- K7: 'sap' dicoret; §9 addendum: 'tiktok_live_session' ditambah (Fase 1A upload).
alter table metric_upload_batches drop constraint if exists metric_upload_batches_source_type_check;
alter table metric_upload_batches add constraint metric_upload_batches_source_type_check
  check (source_type in (
    'mcn_tiktok_product', 'tap_tiktok_product', 'mcn_tiktok_live', 'tap_tiktok_live',
    'shopee', 'tiktok_live_session'
  ));

-- ---------- 2. project_creator_metrics: per-source columns + GENERATED gmv_actual ----------
-- The view must be dropped before gmv_actual's column definition changes underneath it.
drop view if exists creator_project_progress_v;

-- gmv_actual can't be ALTERed into a GENERATED column in place — swap it out.
-- No real data exists yet for this column (project_creator_metrics audited at 0 rows,
-- BUILD_PLAN_M7_V2 §1), but preserve any test value defensively rather than assume that.
alter table project_creator_metrics rename column gmv_actual to gmv_actual_old;
alter table project_creator_metrics add column gmv_product numeric;
alter table project_creator_metrics add column gmv_live_report numeric;
alter table project_creator_metrics add column gmv_shopee numeric;
update project_creator_metrics
set gmv_product = gmv_actual_old
where gmv_actual_old is not null and gmv_actual_old <> 0;
alter table project_creator_metrics drop column gmv_actual_old;

-- R21 (LOCKED, structural): product export always wins gmv_actual; live export only
-- contributes gmv_actual when there is no product row yet for that (creator, date).
alter table project_creator_metrics
  add column gmv_actual numeric generated always as (
    coalesce(gmv_product, gmv_live_report, 0) + coalesce(gmv_shopee, 0)
  ) stored;

alter table project_creator_metrics
  add column if not exists live_gmv numeric,
  add column if not exists video_gmv numeric,
  add column if not exists orders int,
  add column if not exists live_orders int,
  add column if not exists live_sessions int,
  add column if not exists batch_product_id text references metric_upload_batches(batch_id),
  add column if not exists batch_live_id text references metric_upload_batches(batch_id),
  add column if not exists batch_shopee_id text references metric_upload_batches(batch_id),
  add column if not exists updated_at timestamptz not null default now();

-- Recreate the portal view with the new columns it can now surface (own contribution,
-- no margin — same security_invoker posture as 0011).
create or replace view creator_project_progress_v
with (security_invoker = on) as
select pcm.project_id, pcm.creator_id, pcm.date,
       pcm.gmv_actual, pcm.items_sold, pcm.live_gmv, pcm.video_gmv, pcm.orders,
       sp.name as project_name, sp.target_gmv
from project_creator_metrics pcm
join special_projects sp on sp.id = pcm.project_id;

-- ---------- 3. project_creator_products (new, §6.7 / R25) ----------
create table if not exists project_creator_products (
  project_id bigint references special_projects(id),
  creator_id text references creators(id),
  product_id text,
  product_name text,
  shop_name text,
  gmv numeric default 0,
  items int default 0,
  batch_id text references metric_upload_batches(batch_id),
  primary key (project_id, creator_id, product_id)
);
alter table project_creator_products enable row level security;
create policy pcp_read on project_creator_products for select to authenticated using (true);

-- ---------- 4. project_daily_metrics: roll-up columns + manual cost split (B5) ----------
alter table project_daily_metrics
  add column if not exists gmv_live numeric,
  add column if not exists items int,
  add column if not exists orders int,
  add column if not exists ads_spend_manual numeric,
  add column if not exists active_creators int;

-- ---------- 5. Deterministic recompute pipeline (CLAUDE.md #1: SQL, not app loops) ----------

-- recompute_project_daily(p): rolls GMV/items/orders/live/active-creators up from
-- project_creator_metrics per (project, date), and recomputes ads_spend = manual input
-- + project_ads_spend_v (ads_briefs tied to this project). Runs over the union of dates
-- that have either performance rows or a manual cost entry, so a cost-only day (entered
-- before any upload) still gets its ads_spend computed.
create or replace function recompute_project_daily(p bigint) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  with days as (
    select date from project_creator_metrics where project_id = p
    union
    select date from project_daily_metrics where project_id = p
  ),
  rollup as (
    select d.date,
      coalesce(sum(pcm.gmv_actual), 0) as gmv_actual,
      coalesce(sum(pcm.live_gmv), 0) as gmv_live,
      coalesce(sum(pcm.items_sold), 0) as items,
      coalesce(sum(pcm.orders), 0) as orders,
      count(*) filter (where coalesce(pcm.gmv_actual, 0) > 0) as active_creators
    from days d
    left join project_creator_metrics pcm on pcm.project_id = p and pcm.date = d.date
    group by d.date
  )
  insert into project_daily_metrics (project_id, date, gmv_actual, gmv_live, items, orders, active_creators, ads_spend)
  select p, r.date, r.gmv_actual, r.gmv_live, r.items, r.orders, r.active_creators,
         coalesce(dm.ads_spend_manual, 0) + coalesce(pas.ads_spend, 0)
  from rollup r
  left join project_daily_metrics dm on dm.project_id = p and dm.date = r.date
  left join project_ads_spend_v pas on pas.project_id = p and pas.date = r.date
  on conflict (project_id, date) do update set
    gmv_actual = excluded.gmv_actual,
    gmv_live = excluded.gmv_live,
    items = excluded.items,
    orders = excluded.orders,
    active_creators = excluded.active_creators,
    ads_spend = excluded.ads_spend;
end $$;

-- recompute_project_summary(p): special_projects.result_summary from project_daily_metrics
-- + project_participants (§6.9). Feedback/top_creators/top_products blocks arrive with
-- their own fases (3 / 1C) — this is the Fase 0 baseline the dashboard already reads.
create or replace function recompute_project_summary(p bigint) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  sp special_projects%rowtype;
  agg record;
begin
  select * into sp from special_projects where id = p;
  if not found then return; end if;

  select
    coalesce(sum(gmv_actual), 0) as gmv_actual,
    coalesce(sum(gmv_live), 0) as live_gmv,
    coalesce(sum(items), 0) as items,
    coalesce(sum(orders), 0) as orders,
    coalesce(sum(ads_spend), 0) as ads_spend,
    coalesce(sum(creator_commission), 0) as creator_commission,
    coalesce(sum(mea_revenue), 0) as mea_revenue
  into agg
  from project_daily_metrics where project_id = p;

  update special_projects set
    result_summary = jsonb_build_object(
      'computed_at', now(),
      'target_gmv', sp.target_gmv,
      'gmv_actual', agg.gmv_actual,
      'achievement_pct', case when sp.target_gmv > 0 then agg.gmv_actual / sp.target_gmv else 0 end,
      'live_gmv', agg.live_gmv,
      'live_contribution', case when agg.gmv_actual > 0 then agg.live_gmv / agg.gmv_actual else 0 end,
      'orders', agg.orders,
      'items', agg.items,
      'participants_total', (select count(*) from project_participants where project_id = p),
      'participants_active', (select count(distinct creator_id) from project_creator_metrics where project_id = p and gmv_actual > 0),
      'sum_personal_targets', (select coalesce(sum(target_gmv), 0) from project_participants where project_id = p),
      'ads_spend', agg.ads_spend,
      'creator_commission', agg.creator_commission,
      'mea_revenue', agg.mea_revenue,
      'margin', agg.mea_revenue - agg.ads_spend
    ),
    summary_computed_at = now()
  where id = p;
end $$;

-- rollback_batch(b): undo a single upload batch. Clears ONLY the columns that source
-- owns (R21 structural anti-double-count — a live batch never touches gmv_product),
-- then re-runs the same recompute pipeline so downstream numbers settle back down.
create or replace function rollback_batch(b text) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  batch metric_upload_batches%rowtype;
begin
  select * into batch from metric_upload_batches where batch_id = b;
  if not found then
    raise exception 'batch % tidak ditemukan', b;
  end if;

  if batch.source_type in ('mcn_tiktok_product', 'tap_tiktok_product') then
    update project_creator_metrics
    set gmv_product = null, video_gmv = null, orders = null, batch_product_id = null, updated_at = now()
    where batch_product_id = b;
    delete from project_creator_products where batch_id = b;
  elsif batch.source_type in ('mcn_tiktok_live', 'tap_tiktok_live') then
    update project_creator_metrics
    set gmv_live_report = null, live_orders = null, batch_live_id = null, updated_at = now()
    where batch_live_id = b;
  elsif batch.source_type = 'shopee' then
    update project_creator_metrics
    set gmv_shopee = null, batch_shopee_id = null, updated_at = now()
    where batch_shopee_id = b;
  end if;

  update metric_upload_batches set status = 'rolled_back' where batch_id = b;

  if batch.project_id is not null then
    perform recompute_project_daily(batch.project_id);
    perform recompute_project_summary(batch.project_id);
  end if;
end $$;

-- ---------- 6. RLS (new tables): read authenticated, mutate via service role only ----------
-- (project_creator_products already covered in step 3.)

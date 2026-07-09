-- Fase 1: Data pipeline (ingestion + M4 link leakage + M2 report support)

-- ============ platform_metrics_raw: allow per-sub_category rows ============
-- The 0001 unique constraint excluded sub_category, so a creator could not have
-- both a total row and per-sub_category rows for the same metric. Replace it with
-- a NULLS NOT DISTINCT unique index that includes sub_category.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'platform_metrics_raw'::regclass and contype = 'u' limit 1;
  if c is not null then
    execute format('alter table platform_metrics_raw drop constraint %I', c);
  end if;
end $$;
create unique index if not exists platform_metrics_raw_uniq
  on platform_metrics_raw (creator_id, period, metric, source, sub_category, upload_batch)
  nulls not distinct;

-- ============ M4: weekly creator rollup (engine-written, read-only for users) ============
create table creator_link_status (
  creator_id text references creators(id) not null,
  week date not null,                          -- = source_upload_week
  gmv_deal_total numeric not null default 0,   -- GMV on active-deal shops (CSV-1)
  gmv_bocor numeric not null default 0,        -- leaked GMV on active-deal shops
  leak_ratio numeric,                          -- gmv_bocor / gmv_deal_total (null when no basis)
  link_status link_status_t not null,
  computed_at timestamptz default now(),
  primary key (creator_id, week)
);
alter table creator_link_status enable row level security;
create policy cls_select on creator_link_status for select to authenticated using (true);
-- deliberately NO user write policy: engine M4 writes via service role only.

-- ============ Platform alerts (event dari data platform — bukan approval) ============
-- Queryable feed for dashboards (audit_logs stays the immutable trail, management-read).
create table platform_alerts (
  id bigserial primary key,
  alert_type text not null check (alert_type in
    ('link_bocor','deal_expiring','deal_expired','commission_drop','token_regression')),
  entity_type text not null, entity_id text,
  message text not null, payload jsonb,
  week date, resolved bool not null default false,
  created_at timestamptz default now()
);
create index on platform_alerts (alert_type, resolved);
alter table platform_alerts enable row level security;
create policy alerts_select on platform_alerts for select to authenticated using (true);
-- inserts via service role (engine) only.

-- ============ bd_leads: idempotent weekly refresh per shop ============
create unique index bd_leads_shop_uniq on bd_leads (shop_id);

-- ============ Config: M4 expiry alert window (H-7 default) ============
insert into app_config(key, value) values ('m4.expiry_alert_days', '7')
on conflict (key) do nothing;

-- ============================================================
-- 0056_m7_v2_live_sessions.sql
-- M7 v2 Special Project — Fase 1A / PR-05: TikTok LIVE Center session schema
-- (PRD addendum §9/§10). Depends on 0052–0055.
-- ============================================================

-- ---------- 1. project_live_sessions (§9/§10.4) ----------
create table project_live_sessions (
  id bigserial primary key,
  project_id bigint references special_projects(id) not null,
  creator_id text references creators(id) not null,
  session_date date not null,
  session_no int not null,
  -- Brand isn't in either export's headers (§9) — team enters it manually at
  -- the confirmation screen (PR-08); informational only, never a verification check.
  brand text,
  start_time time,
  end_time time,
  duration_min int,
  -- GMV source of truth = Product file (§9/§10.2 V6); gmv_trend is Trend Stats'
  -- own total, kept only to show/compare, never authoritative on its own.
  gmv numeric not null default 0,
  gmv_trend numeric,
  orders int not null default 0,
  items int not null default 0,
  customers int not null default 0,
  views int,
  viewers_peak int,
  impressions_live int,
  product_impressions int,
  product_clicks int,
  add_to_cart int,
  new_followers int,
  shares int,
  comments int,
  likes int,
  ctr numeric,
  ctor numeric,
  aov numeric,
  gpm numeric,
  -- §10.1 R41: only verified/confirmed_manual roll up into report/result_summary.
  attribution_status text not null default 'verified'
    check (attribution_status in ('verified', 'confirmed_manual', 'disputed', 'voided')),
  attribution_note text,
  confirmed_by uuid references team_members(id),
  confirmed_at timestamptz,
  checks_json jsonb,
  filename_product text,
  filename_trend text,
  -- V4 (§10.2): a file must never be ingested twice, in ANY project. Hash per
  -- source file (not one column) since Product/Trend can arrive in separate uploads.
  file_hash_product text,
  file_hash_trend text,
  uploaded_by uuid references team_members(id),
  disputed_at timestamptz,
  dispute_reason text,
  batch_id text references metric_upload_batches(batch_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- R37: one row per (creator, date, session number) — multiple sessions/day allowed,
  -- never merged at storage level.
  unique (project_id, creator_id, session_date, session_no)
);
create index idx_live_sessions_project_creator_date
  on project_live_sessions (project_id, creator_id, session_date);
create unique index idx_live_sessions_hash_product
  on project_live_sessions (file_hash_product) where file_hash_product is not null;
create unique index idx_live_sessions_hash_trend
  on project_live_sessions (file_hash_trend) where file_hash_trend is not null;

-- ---------- 2. project_live_intervals (§9, per-30-min chart data) ----------
create table project_live_intervals (
  id bigserial primary key,
  session_id bigint references project_live_sessions(id) on delete cascade not null,
  time text not null, -- as printed by the export ("19:30") — display/chart use only
  gmv numeric not null default 0,
  orders int not null default 0,
  items int not null default 0,
  views int,
  viewers int,
  product_impressions int,
  product_clicks int,
  likes int,
  comments int,
  shares int,
  new_followers int
);
create index idx_live_intervals_session on project_live_intervals (session_id);

-- ---------- 3. creator_username_aliases (§10.1 R42 — TikTok usernames change) ----------
create table creator_username_aliases (
  id bigserial primary key,
  creator_id text references creators(id) not null,
  username text not null,
  platform text not null default 'tiktok',
  valid_from date,
  valid_to date,
  added_by uuid references team_members(id),
  reason text,
  created_at timestamptz not null default now()
);
create index idx_alias_creator on creator_username_aliases (creator_id);
-- One username can't be an alias of two different creators — same invariant as
-- creators.username itself (unique since migration 0050).
create unique index creator_username_aliases_platform_username_key
  on creator_username_aliases (platform, lower(username));

-- ---------- 4. project_creator_daily_live_v (§10.4 — "gabungan 1 hari" for the report) ----------
-- Only verified/confirmed_manual sessions count (R41) — enforced HERE in the view,
-- not by an application-side filter (CLAUDE.md #4).
create view project_creator_daily_live_v with (security_invoker = on) as
select
  s.project_id, s.creator_id, s.session_date,
  count(*)::int as sessions,
  sum(s.gmv) as gmv,
  sum(s.orders) as orders,
  sum(s.items) as items,
  sum(s.customers) as customers,
  sum(s.duration_min) as duration_min,
  sum(s.views) as views,
  max(s.viewers_peak) as viewers_peak,
  sum(s.product_impressions) as product_impressions,
  sum(s.product_clicks) as product_clicks,
  sum(s.add_to_cart) as add_to_cart,
  sum(s.new_followers) as new_followers,
  sum(s.comments) as comments,
  sum(s.likes) as likes,
  sum(s.shares) as shares,
  (array_agg(s.session_no order by s.gmv desc, s.session_no))[1] as best_session_no,
  max(s.gmv) as best_session_gmv
from project_live_sessions s
where s.attribution_status in ('verified', 'confirmed_manual')
group by s.project_id, s.creator_id, s.session_date;

-- ---------- 5. RLS ----------
-- Read for internal team (authenticated), mutate via service role only — same
-- pattern as every other M7 table. Plus a RESTRICTIVE deny for creator_user:
-- nothing in this fase reads these tables from the creator portal yet (the
-- self-scoped dispute view is Fase 3/PR-26), so default to denying that
-- principal entirely rather than leaving a permissive `using (true)` open to it
-- (same posture as ads_briefs/ads_campaign_results in 0012).
alter table project_live_sessions       enable row level security;
alter table project_live_intervals      enable row level security;
alter table creator_username_aliases    enable row level security;

create policy live_sessions_select on project_live_sessions for select to authenticated using (true);
create policy live_intervals_select on project_live_intervals for select to authenticated using (true);
create policy alias_select on creator_username_aliases for select to authenticated using (true);

create policy live_sessions_deny_creator on project_live_sessions as restrictive for select using (not is_creator_user());
create policy live_intervals_deny_creator on project_live_intervals as restrictive for select using (not is_creator_user());
create policy alias_deny_creator on creator_username_aliases as restrictive for select using (not is_creator_user());

-- ---------- 6. Per-(creator, date) live roll-up into project_creator_metrics (R21/R38) ----------
-- Called by the upload action after every session save/void/reassign, for the
-- affected (project, creator, date) key; the caller then runs
-- recompute_project_daily/recompute_project_summary same as any other batch.
create or replace function recompute_creator_daily_live(p bigint, c text, d date) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  total_gmv numeric;
  total_orders int;
  total_sessions int;
begin
  select coalesce(sum(gmv), 0), coalesce(sum(orders), 0), count(*)
  into total_gmv, total_orders, total_sessions
  from project_live_sessions
  where project_id = p and creator_id = c and session_date = d
    and attribution_status in ('verified', 'confirmed_manual');

  insert into project_creator_metrics
    (project_id, creator_id, date, gmv_live_report, live_gmv, live_orders, live_sessions, updated_at)
  values (p, c, d, total_gmv, total_gmv, total_orders, total_sessions, now())
  on conflict (project_id, creator_id, date) do update set
    gmv_live_report = excluded.gmv_live_report,
    -- No product-export live/video split yet (that's Fase 1B) — for a live-only
    -- project, live_gmv defaults to the live rollup itself (§6.7 fallback rule).
    live_gmv = case when project_creator_metrics.gmv_product is null then excluded.live_gmv else project_creator_metrics.live_gmv end,
    live_orders = excluded.live_orders,
    live_sessions = excluded.live_sessions,
    updated_at = now();
end $$;

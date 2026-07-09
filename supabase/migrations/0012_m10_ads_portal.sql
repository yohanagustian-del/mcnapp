-- ============================================================
-- 0012_m10_ads_portal.sql  (draft 0009 → renumbered; corrected to real schema)
-- Module 10: Campaign & Ads Support Portal (internal; role ads_support = sub-Campaign Ops).
-- GMV live-ads = manual columns (ads_spent,gmv,cpm,ctr,cvr,roas), no xlsx.
-- ads_spent is the SINGLE source of ads spend → M7 (project profitability) & M8 (cap check).
--
-- Corrections vs README draft:
--   - brand_deals.id / creators.id are text (matches).
--   - ROAS cross-check tolerance read from app_config m10.roas_crosscheck_tol (no hardcoded 0.05).
--   - added ads_briefs.project_id (nullable) so ads_spent can feed M7 project_daily_metrics
--     deterministically (single source; BUILD_PLAN §6 "ads spend single-source → M7").
--   - creator_user principal fully denied on both tables (§ RLS).
-- ============================================================

-- ---------- 1. Brief ----------
create table if not exists ads_briefs (
  id               bigserial primary key,
  source           text not null check (source in ('cm','bizdev')),
  creator_id       text references creators(id),
  deal_id          text references brand_deals(id),
  project_id       bigint references special_projects(id),   -- set when the campaign is part of a project
  objective        text,
  budget_requested numeric,
  budget_approved  numeric,
  period_start     date,
  period_end       date,
  status           text not null default 'baru'
                     check (status in ('baru','menunggu_approval','dikerjakan','selesai','batal')),
  assigned_to      uuid references team_members(id),
  created_by       uuid references team_members(id),
  notes            text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_briefs_status on ads_briefs(status);
create index if not exists idx_briefs_assigned on ads_briefs(assigned_to);
create index if not exists idx_briefs_project on ads_briefs(project_id);

-- ---------- 2. Results (manual columns) ----------
create table if not exists ads_campaign_results (
  id          bigserial primary key,
  brief_id    bigint not null references ads_briefs(id) on delete cascade,
  period      date not null,
  ads_spent   numeric not null,             -- single source of ads spend
  gmv         numeric not null,             -- live-ads GMV (manual; different context from M2 platform GMV)
  cpm         numeric,
  ctr         numeric,
  cvr         numeric,
  roas        numeric,                       -- manual; cross-checked below
  status      text not null default 'draft' check (status in ('draft','final')),
  flagged     boolean not null default false,-- true when roas ≠ gmv/ads_spent (review, not a block)
  created_by  uuid references team_members(id),
  created_at  timestamptz not null default now(),
  unique (brief_id, period)
);
create index if not exists idx_ads_results_brief on ads_campaign_results(brief_id);

-- Cross-check roas vs gmv/ads_spent → set flagged. Tolerance from app_config (not hardcoded).
create or replace function ads_result_crosscheck() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare computed numeric; tol numeric;
begin
  select coalesce((value #>> '{}')::numeric, 0.05) into tol
  from app_config where key = 'm10.roas_crosscheck_tol';
  tol := coalesce(tol, 0.05);
  if new.ads_spent is not null and new.ads_spent > 0 and new.roas is not null then
    computed := new.gmv / new.ads_spent;
    if abs(computed - new.roas) > greatest(computed, new.roas) * tol then
      new.flagged := true;
    else
      new.flagged := false;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ads_crosscheck on ads_campaign_results;
create trigger trg_ads_crosscheck before insert or update on ads_campaign_results
  for each row execute function ads_result_crosscheck();

-- ---------- 3. Surface views (read-only, no recompute) ----------
create or replace view ads_results_for_bizdev_v with (security_invoker = on) as
select b.deal_id, r.period, r.ads_spent, r.gmv, r.cpm, r.ctr, r.cvr, r.roas, r.flagged
from ads_campaign_results r join ads_briefs b on b.id = r.brief_id
where b.deal_id is not null and r.status = 'final';

create or replace view ads_results_for_cm_v with (security_invoker = on) as
select b.creator_id, r.period, r.ads_spent, r.gmv, r.roas, r.flagged
from ads_campaign_results r join ads_briefs b on b.id = r.brief_id
where b.creator_id is not null and r.status = 'final';

-- Single-source ads spend for M7: sum ads_spent per (project, period). M7 reads this — no re-input.
create or replace view project_ads_spend_v with (security_invoker = on) as
select b.project_id, r.period as date, sum(r.ads_spent) as ads_spend
from ads_campaign_results r join ads_briefs b on b.id = r.brief_id
where b.project_id is not null
group by b.project_id, r.period;

-- ---------- 4. RLS (internal via service role + requirePermission; creator_user denied) ----------
alter table ads_briefs           enable row level security;
alter table ads_campaign_results enable row level security;
-- Internal reads use the service-role client (bypass); add permissive select for authenticated
-- internal parity with existing tables, then a restrictive deny for the creator_user principal.
create policy ads_briefs_select on ads_briefs for select to authenticated using (true);
create policy ads_results_select on ads_campaign_results for select to authenticated using (true);
create policy ads_briefs_deny_creator on ads_briefs as restrictive for select using (not is_creator_user());
create policy ads_results_deny_creator on ads_campaign_results as restrictive for select using (not is_creator_user());

-- ---------- 5. app_config ----------
insert into app_config (key, value) values
  ('m10.brief_priority',      '{"deadline_weight":0.6,"budget_weight":0.4}'::jsonb),
  ('m10.roas_crosscheck_tol', '0.05'::jsonb)
on conflict (key) do nothing;

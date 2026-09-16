-- ============================================================
-- 0058_m7_v2_recruitment.sql
-- M7 v2 Special Project — Fase 2 / PR-19: creator requirements, shortlist,
-- join-request upgrade, external applicants (PRD §6.4-§6.6).
-- Depends on 0052-0057.
-- ============================================================

-- ---------- 1. project_creator_requirements (§6.4) ----------
create table project_creator_requirements (
  project_id bigint primary key references special_projects(id) on delete cascade,
  niches text[],
  platform text check (platform in ('tiktok', 'shopee', 'all')) default 'all',
  min_level smallint,
  follower_tiers text[],
  min_gmv_30d numeric,
  require_live_roster boolean not null default false,
  quota integer,
  notes text,
  updated_by uuid references team_members(id),
  updated_at timestamptz not null default now()
);
alter table project_creator_requirements enable row level security;
create policy pcr_select on project_creator_requirements for select to authenticated using (true);

-- ---------- 2. project_join_requests upgrade (§6.5) ----------
-- Existing rows ('diajukan'/'diterima'/'ditolak') stay valid under the wider check.
alter table project_join_requests drop constraint if exists project_join_requests_status_check;
alter table project_join_requests
  add column if not exists source text not null default 'portal' check (source in ('portal', 'invite')),
  add column if not exists reason text,
  add column if not exists note text,
  add column if not exists score numeric;
alter table project_join_requests add constraint project_join_requests_status_check
  check (status in ('diajukan', 'diundang', 'diterima', 'ditolak', 'waitlist', 'dibatalkan'));

-- Creator may only respond to an invite of their OWN, and only diundang → diterima/ditolak
-- (no existing permissive UPDATE policy on this table, so this is additive, not a narrowing).
create policy pjr_creator_respond on project_join_requests for update
  using (is_creator_user() and creator_id = auth_creator_id() and status = 'diundang')
  with check (is_creator_user() and creator_id = auth_creator_id() and status in ('diterima', 'ditolak'));

-- ---------- 3. project_external_applicants (§6.6) ----------
create table project_external_applicants (
  id bigserial primary key,
  project_id bigint not null references special_projects(id) on delete cascade,
  full_name text not null,
  username text not null,
  platform text not null default 'tiktok',
  phone text,
  followers bigint,
  niche text,
  answers_json jsonb,
  consent_contact boolean not null,
  ip_hash text,
  user_agent text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references team_members(id),
  reviewed_at timestamptz,
  review_note text,
  created_creator_id text references creators(id),
  created_at timestamptz not null default now()
);
create unique index project_external_applicants_project_username_key
  on project_external_applicants (project_id, lower(username), platform);
-- RLS: internal reads only (authenticated) — the public /join/{slug} endpoint writes
-- via service role, never via an anon insert policy (§6.6: "tanpa RLS anon").
alter table project_external_applicants enable row level security;
create policy pea_select on project_external_applicants for select to authenticated using (true);

-- ---------- 4. project_shortlist(project_id) (§6.4) ----------
-- Deterministic scoring, weights from app_config m7.shortlist_weights (already
-- seeded in 0055) — CLAUDE.md #1: no LLM anywhere in matching/scoring.
-- Basis: creator_period_summary, latest 4 distinct periods per creator.
-- Excludes creators already a participant or with a live/pending join request.
create or replace function project_shortlist(p_project_id bigint)
returns table (
  creator_id text, name text, niche text, level smallint,
  gmv_30d numeric, live_share numeric, owner_cpm_id uuid, score numeric
)
language sql stable set search_path = public, pg_temp as $$
  with req as (
    select * from project_creator_requirements where project_id = p_project_id
  ),
  weights as (
    select
      coalesce((value->>'gmv')::numeric, 0.4) as w_gmv,
      coalesce((value->>'niche')::numeric, 0.25) as w_niche,
      coalesce((value->>'level')::numeric, 0.2) as w_level,
      coalesce((value->>'live')::numeric, 0.15) as w_live
    from app_config where key = 'm7.shortlist_weights'
  ),
  period_totals as (
    select cps.creator_id, cps.period_start,
      sum(cps.gmv_total) as gmv_total,
      sum(cps.affiliate_gmv) as affiliate_gmv,
      sum(cps.affiliate_live_gmv) as affiliate_live_gmv
    from creator_period_summary cps
    group by cps.creator_id, cps.period_start
  ),
  ranked_periods as (
    select *, row_number() over (partition by creator_id order by period_start desc) as rn
    from period_totals
  ),
  recent4 as (
    select creator_id,
      sum(gmv_total) as gmv_30d,
      sum(affiliate_live_gmv) as live_gmv,
      sum(affiliate_gmv) as affiliate_gmv
    from ranked_periods where rn <= 4
    group by creator_id
  ),
  candidates as (
    select
      c.id as creator_id, c.name, c.niche, c.level, c.owner_cpm_id,
      coalesce(r4.gmv_30d, 0) as gmv_30d,
      case when coalesce(r4.affiliate_gmv, 0) > 0 then r4.live_gmv / r4.affiliate_gmv else 0 end as live_share
    from creators c
    left join recent4 r4 on r4.creator_id = c.id
    where not exists (
      select 1 from project_participants pp
      where pp.project_id = p_project_id and pp.creator_id = c.id
    )
    and not exists (
      select 1 from project_join_requests pjr
      where pjr.project_id = p_project_id and pjr.creator_id = c.id
        and pjr.status in ('diajukan', 'diundang', 'diterima', 'waitlist')
    )
    and ((select niches from req) is null or c.niche = any(select unnest(niches) from req))
    and ((select min_level from req) is null or c.level >= (select min_level from req))
    and ((select min_gmv_30d from req) is null or coalesce(r4.gmv_30d, 0) >= (select min_gmv_30d from req))
    and (
      (select platform from req) is null or (select platform from req) = 'all'
      or c.platform = (select platform from req)
    )
    and (
      (select follower_tiers from req) is null
      or c.follower_tier = any(select unnest(follower_tiers) from req)
    )
  )
  select
    cd.creator_id, cd.name, cd.niche, cd.level, cd.gmv_30d, cd.live_share, cd.owner_cpm_id,
    (
      -- coalesce each term to 0 individually — a single null term (e.g. every
      -- candidate at gmv_30d=0, making the max()-normalized ratio null) must
      -- not poison the whole sum and erase the niche/level/live components.
      coalesce(w.w_gmv * (cd.gmv_30d / nullif((select max(gmv_30d) from candidates), 0)), 0)
      + coalesce(w.w_niche * (case when (select niches from req) is not null and cd.niche = any(select unnest(niches) from req) then 1 else 0 end), 0)
      + coalesce(w.w_level * (coalesce(cd.level, 0)::numeric / 6), 0)
      + coalesce(w.w_live * cd.live_share, 0)
    ) as score
  from candidates cd, weights w
  order by score desc nulls last
  limit 100;
$$;

-- ---------- 5. join_rate_limits (§3.5, PR-22: 5/menit/IP on /api/join/{slug}) ----------
-- Table-backed instead of in-memory: this repo is serverless (no shared process
-- state between invocations), so a counter needs to live somewhere durable.
-- One row per attempt (written before any other validation, success or not) —
-- service role only, never exposed to anon/authenticated.
create table join_rate_limits (
  id bigserial primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index idx_join_rate_limits_ip_time on join_rate_limits (ip_hash, created_at);
alter table join_rate_limits enable row level security;
-- No select/insert policy at all — only the service-role client (route handler)
-- can touch this table; anon/authenticated get nothing.

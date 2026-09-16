-- ============================================================
-- 0059_m7_v2_portal.sql
-- M7 v2 Special Project — Fase 3 / PR-23: project info (announcements) &
-- feedback schema (PRD §6.10/§6.11). Depends on 0052-0058.
-- ============================================================

-- ---------- 1. project_announcements (§6.10, R17) ----------
create table project_announcements (
  id bigserial primary key,
  project_id bigint references special_projects(id) not null,
  title text not null,
  body_md text not null,
  attachments jsonb not null default '[]'::jsonb,
  pinned boolean not null default false,
  -- Draft until published; R17 hides it from the portal until published_at <= now().
  published_at timestamptz,
  created_by uuid references team_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_announcements_project on project_announcements (project_id, published_at desc);

create table project_announcement_reads (
  announcement_id bigint references project_announcements(id) on delete cascade not null,
  creator_id text references creators(id) not null,
  read_at timestamptz not null default now(),
  primary key (announcement_id, creator_id)
);

-- ---------- 2. project_feedback (§6.11, R31/R32) ----------
create table project_feedback (
  id bigserial primary key,
  project_id bigint references special_projects(id) not null,
  creator_id text references creators(id) not null,
  rating_overall smallint check (rating_overall between 1 and 5),
  rating_materi smallint check (rating_materi between 1 and 5),
  rating_mentor smallint check (rating_mentor between 1 and 5),
  rating_organisasi smallint check (rating_organisasi between 1 and 5),
  nps smallint check (nps between 0 and 10),
  would_join_again boolean,
  best_part text,
  improvement text,
  -- Rule-based only (src/lib/m7/feedback-sentiment.ts) — never written by an LLM call.
  sentiment text check (sentiment in ('positif', 'netral', 'negatif')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, creator_id)
);

-- ---------- 3. RLS ----------
-- Same posture as elsewhere in M7 v2: permissive baseline for the internal team,
-- RESTRICTIVE narrowing for the creator_user principal (CLAUDE.md #4/RBAC).
alter table project_announcements       enable row level security;
alter table project_announcement_reads  enable row level security;
alter table project_feedback            enable row level security;

create policy announcements_select on project_announcements for select to authenticated using (true);
create policy announcement_reads_select on project_announcement_reads for select to authenticated using (true);
create policy feedback_select on project_feedback for select to authenticated using (true);

-- R17: a creator may only see a project's announcement once it's published AND
-- they're a participant of that project.
create policy announcements_creator_scope on project_announcements as restrictive for select using (
  not is_creator_user()
  or (
    published_at is not null and published_at <= now()
    and exists (
      select 1 from project_participants pp
      where pp.project_id = project_announcements.project_id and pp.creator_id = auth_creator_id()
    )
  )
);

-- A creator may only see/insert their own read receipts.
create policy announcement_reads_creator_scope on project_announcement_reads as restrictive for select using (
  not is_creator_user() or creator_id = auth_creator_id()
);
create policy announcement_reads_creator_insert on project_announcement_reads for insert
  with check (is_creator_user() and creator_id = auth_creator_id());

-- R32: creator sees only their own feedback row; team sees all (feedback_select above).
create policy feedback_creator_scope on project_feedback as restrictive for select using (
  not is_creator_user() or creator_id = auth_creator_id()
);
-- R31: creator may submit/edit their own feedback only while the project's
-- feedback window is open. Kept here as defense-in-depth (writes normally go
-- through the service-role portal action, which enforces the same window).
create policy feedback_creator_write on project_feedback for insert with check (
  is_creator_user() and creator_id = auth_creator_id()
  and exists (
    select 1 from special_projects sp
    where sp.id = project_feedback.project_id
      and (sp.status = 'selesai' or coalesce(sp.feedback_open_at, 'infinity'::timestamptz) <= now())
      and now() <= coalesce(sp.feedback_close_at, 'infinity'::timestamptz)
  )
);
create policy feedback_creator_update on project_feedback for update
  using (is_creator_user() and creator_id = auth_creator_id())
  with check (
    is_creator_user() and creator_id = auth_creator_id()
    and exists (
      select 1 from special_projects sp
      where sp.id = project_feedback.project_id
        and now() <= coalesce(sp.feedback_close_at, 'infinity'::timestamptz)
    )
  );

-- ---------- 4. project_live_sessions: allow creator self-read (§10.3/PR-26) ----------
-- 0056 denied creator_user entirely (nothing read this table from the portal yet).
-- Fase 3 adds the "Sesi Live Saya" list + dispute button, so narrow that deny to a
-- scoped allow instead of dropping it outright.
drop policy if exists live_sessions_deny_creator on project_live_sessions;
create policy live_sessions_creator_scope on project_live_sessions as restrictive for select using (
  not is_creator_user() or creator_id = auth_creator_id()
);

-- ---------- 5. recompute_project_summary(): add the §6.9 `feedback` block ----------
-- Re-declared in full (CREATE OR REPLACE) to extend the Fase 0 version (0054) with
-- the feedback aggregate — deterministic SQL, no application-side re-aggregation
-- (CLAUDE.md #4/#8). NPS = %promoters(9-10) − %detractors(0-6), standard formula.
create or replace function recompute_project_summary(p bigint) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  sp special_projects%rowtype;
  agg record;
  fb record;
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

  select
    count(*) as responses,
    avg(rating_overall) as avg_overall,
    avg(rating_materi) as avg_materi,
    avg(rating_mentor) as avg_mentor,
    avg(rating_organisasi) as avg_organisasi,
    case when count(nps) > 0
      then (count(*) filter (where nps >= 9))::numeric / count(nps) - (count(*) filter (where nps <= 6))::numeric / count(nps)
      else null end as nps_score,
    case when count(would_join_again) > 0
      then (count(*) filter (where would_join_again))::numeric / count(would_join_again)
      else null end as would_again_pct
  into fb
  from project_feedback where project_id = p;

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
      'margin', agg.mea_revenue - agg.ads_spend,
      'feedback', jsonb_build_object(
        'responses', fb.responses,
        'avg_overall', fb.avg_overall,
        'avg_materi', fb.avg_materi,
        'avg_mentor', fb.avg_mentor,
        'avg_organisasi', fb.avg_organisasi,
        'nps', fb.nps_score,
        'would_join_again_pct', fb.would_again_pct
      )
    ),
    summary_computed_at = now()
  where id = p;
end $$;

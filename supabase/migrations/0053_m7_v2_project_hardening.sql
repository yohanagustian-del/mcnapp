-- ============================================================
-- 0053_m7_v2_project_hardening.sql
-- M7 v2 Special Project — Fase 0 / PR-02: harden special_projects/
-- project_manpower/project_participants + purge test projects.
-- Depends on 0052 (project_type_t, manpower_role_t, project_status_t 'dibatalkan').
-- ============================================================

-- ---------- 1. special_projects: portal/report scaffolding columns (R3, §6.1) ----------
alter table special_projects
  add column if not exists slug text unique,
  add column if not exists description text,
  add column if not exists signup_deadline timestamptz,
  add column if not exists feedback_open_at timestamptz,
  add column if not exists feedback_close_at timestamptz,
  add column if not exists summary_computed_at timestamptz;

-- Backfill slug for existing projects (slugify name + id — id makes it unique by
-- construction, no collision handling needed). New projects get theirs from the
-- app right after insert (createProject), once the row id is known.
update special_projects
set slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || id::text
where slug is null;

-- ---------- 2. special_projects.type: free text → project_type_t (§6.1) ----------
-- Mapping locked in PRD §6.1 / BUILD_PLAN §0.2, verified against live values
-- (flash_sale, campaign, live_event, bootcamp, china, Showcase, China Trip, Bootcamp,
-- showcase testing); anything else (including null) → 'other'.
alter table special_projects add column type_new project_type_t;
update special_projects set type_new = (
  case lower(trim(coalesce(type, '')))
    when 'bootcamp' then 'bootcamp'
    when 'china trip' then 'trip'
    when 'china' then 'trip'
    when 'showcase' then 'showcase'
    when 'showcase testing' then 'showcase'
    when 'live_event' then 'event'
    when 'flash_sale' then 'campaign'
    when 'campaign' then 'campaign'
    else 'other'
  end
)::project_type_t;
alter table special_projects drop column type;
alter table special_projects rename column type_new to type;
alter table special_projects alter column type set not null;
alter table special_projects alter column type set default 'other';

-- ---------- 3. project_manpower: involvement (text) → involvement_pct (§6.2, R5) ----------
alter table project_manpower add column involvement_pct smallint;
update project_manpower
set involvement_pct = nullif(regexp_replace(involvement, '[^0-9]', '', 'g'), '')::smallint
where involvement is not null;
alter table project_manpower
  add constraint pm_involvement_pct_range check (involvement_pct is null or involvement_pct between 0 and 100);
alter table project_manpower drop column involvement;

-- project_manpower.role (free text) → manpower_role_t, best-effort keyword mapping;
-- unmatched free text lands in 'other' rather than being dropped (CLAUDE.md #7: don't
-- crash / silently lose data on dirty legacy input).
alter table project_manpower add column role_new manpower_role_t;
update project_manpower set role_new = (
  case
    when role is null then null
    when lower(role) like '%pic%' then 'pic'
    when lower(role) like '%project manager%' or lower(role) like '%pm%' then 'project_manager'
    when lower(role) like '%cpm%' then 'cpm'
    when lower(role) like '%cm%' then 'cm'
    when lower(role) like '%akuisisi%' then 'akuisisi'
    when lower(role) like '%bizdev%' then 'bizdev'
    when lower(role) like '%support%' then 'support'
    else 'other'
  end
)::manpower_role_t;
alter table project_manpower drop column role;
alter table project_manpower rename column role_new to role;

-- ---------- 4. project_participants: target_gmv wajib + provenance (R4, §6.3) ----------
update project_participants pp
set target_gmv = coalesce(
  pp.target_gmv,
  (select sp.target_gmv / nullif(sp.target_creators, 0)
     from special_projects sp where sp.id = pp.project_id),
  0
)
where pp.target_gmv is null;

alter table project_participants
  add column if not exists added_via text not null default 'manual'
    check (added_via in ('manual', 'portal', 'invite', 'external')),
  add column if not exists portal_invited_at timestamptz;

alter table project_participants alter column target_gmv set not null;
alter table project_participants alter column target_gmv set default 0;

-- ---------- 5. Purge test projects id 4, 5, 10 (dump before delete — CLAUDE.md #2) ----------
-- Audit dump captures every row (parent + all known children) as `before`; `after` is
-- null because this is a deletion, not a state change. Actor is the migration itself
-- (no team_members actor for a schema migration), matching the actor_label convention
-- introduced in 0010 for non-team_members principals.
do $$
declare
  purge_ids constant bigint[] := array[4, 5, 10];
  dump jsonb;
begin
  select jsonb_build_object(
    'special_projects', (select coalesce(jsonb_agg(sp), '[]'::jsonb) from special_projects sp where sp.id = any(purge_ids)),
    'project_participants', (select coalesce(jsonb_agg(pp), '[]'::jsonb) from project_participants pp where pp.project_id = any(purge_ids)),
    'project_manpower', (select coalesce(jsonb_agg(pm), '[]'::jsonb) from project_manpower pm where pm.project_id = any(purge_ids)),
    'project_daily_metrics', (select coalesce(jsonb_agg(pdm), '[]'::jsonb) from project_daily_metrics pdm where pdm.project_id = any(purge_ids)),
    'project_creator_metrics', (select coalesce(jsonb_agg(pcm), '[]'::jsonb) from project_creator_metrics pcm where pcm.project_id = any(purge_ids)),
    'project_join_requests', (select coalesce(jsonb_agg(pjr), '[]'::jsonb) from project_join_requests pjr where pjr.project_id = any(purge_ids))
  ) into dump;

  insert into audit_logs (actor_id, actor_label, action, entity_type, entity_id, before, after, type)
  values (
    null, 'system:migration_0053_m7_v2_project_hardening', 'm7.project_purge', 'special_projects',
    array_to_string(purge_ids, ','), dump, null, 'auto'
  );

  delete from project_creator_metrics where project_id = any(purge_ids);
  delete from project_join_requests where project_id = any(purge_ids);
  delete from project_daily_metrics where project_id = any(purge_ids);
  delete from project_manpower where project_id = any(purge_ids);
  delete from project_participants where project_id = any(purge_ids);
  delete from special_projects where id = any(purge_ids);
end $$;

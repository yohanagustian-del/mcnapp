-- ============================================================
-- 0010_rbac_foundation.sql
-- Phase 5.0 (BLOCKING) — foundation for M9–M12.
-- Adds principals/roles used by the external portal + governance layer:
--   - role_t   += 'od_viewer' (read-only oversight, M11), 'ads_support' (sub-role Campaign Ops, M10)
--   - team_group_t += 'od'
--   - audit_logs.actor_label  → string actor for non-team_members principals
--     (creator_user:CRT-xxxxx, system:retention). actor_id stays uuid for team_members/director:<id>.
--   - JWT-claim helpers reused by M9/M11 RLS (auth_creator_id, is_creator_user, is_od_viewer)
--   - guard_last_director: refuse deactivating the last active Director (multi-Director, M11)
-- NOTE: enum ADD VALUE runs here (own migration) so later migrations may reference the new
--       roles; new enum labels cannot be *used* in the same transaction they are added.
-- ============================================================

-- ---------- 1. Enum extensions ----------
alter type role_t       add value if not exists 'ads_support';
alter type role_t       add value if not exists 'od_viewer';
alter type team_group_t add value if not exists 'od';

-- ---------- 2. audit_logs: string actor for non-team_member principals ----------
-- actor_id (uuid → team_members) stays for internal/director actions.
-- actor_label holds 'creator_user:CRT-xxxxx' | 'system:retention' | etc. when actor_id is null.
alter table audit_logs
  add column if not exists actor_label text;

-- ---------- 3. JWT-claim helpers (creator_user principal + od_viewer) ----------
-- Claims 'role' and 'creator_id' are injected into the access token via a Supabase
-- auth hook (configured out-of-band). These are safe no-ops for internal team_members
-- tokens (which carry role but not creator_id).
create or replace function auth_creator_id() returns text
language sql stable set search_path = public, pg_temp as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'creator_id', '')
$$;

create or replace function is_creator_user() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'creator_user',
    false)
$$;

create or replace function is_od_viewer() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'od_viewer',
    false)
$$;

-- ---------- 4. Multi-Director: guard the last active Director ----------
-- team_members uses `active bool` (no status column). Refuse the update/delete that would
-- leave 0 active Directors. Director accounts are otherwise fully equal (any-Director approval).
create or replace function guard_last_director() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare active_dirs int;
begin
  if old.role = 'director'
     and ( (tg_op = 'DELETE')
        or (tg_op = 'UPDATE' and old.active = true and new.active = false) ) then
    select count(*) into active_dirs
    from team_members
    where role = 'director' and active = true and id <> old.id;
    if active_dirs < 1 then
      raise exception 'cannot deactivate the last active Director (at least 1 required)';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_last_director_upd on team_members;
create trigger trg_last_director_upd before update on team_members
  for each row execute function guard_last_director();
drop trigger if exists trg_last_director_del on team_members;
create trigger trg_last_director_del before delete on team_members
  for each row execute function guard_last_director();

-- ---------- 5. app_config (M11 governance defaults) ----------
insert into app_config (key, value) values
  ('m11.dual_approval_actions', '[]'::jsonb),   -- default: any single Director; opt-in to dual later
  ('m11.od_restricted_fields',  '[]'::jsonb)    -- fields OD sees as aggregate only (default none)
on conflict (key) do nothing;
